"""Répartition de la flotte entre workers de perception.

Un worker servait un seul robot, figé dans sa configuration. Ces tests tiennent
les propriétés qui permettent d'en servir plusieurs sans que deux workers se
marchent dessus, et surtout celle qui manquait le 23 septembre 2026 : savoir
qu'un robot n'est couvert par personne.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from test_ai_box_composition import _corps_box, _televerse, uniq

CLE_WORKER = {"X-Oscar-Worker-Key": "test-perception-worker-key"}


@pytest.fixture()
def flotte(client, admin_headers):
    """Une organisation, deux robots, dont un seul a des modèles à faire tourner."""
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("Perception"), "slug": uniq("perception")}).json()
    entetes = {**admin_headers, "X-Organization-ID": org["id"]}

    servi = client.post("/api/robots", headers=entetes,
                        json={"nom": uniq("Servi"), "org_id": org["id"]}).json()
    nu = client.post("/api/robots", headers=entetes,
                     json={"nom": uniq("Sans box"), "org_id": org["id"]}).json()

    modele = _televerse(client, entetes, tache="product_detection")
    box = client.post("/api/ai/model-boxes", headers=entetes,
                      json=_corps_box([modele["id"]])).json()
    client.post(f"/api/ai/model-boxes/{box['id']}/publish", headers=entetes)
    r = client.put(f"/api/ai/model-boxes/{box['id']}/assignments/robot/{servi['id']}",
                   headers=entetes, json={"enabled": True})
    assert r.status_code in (200, 201), r.text
    return {"org": org, "entetes": entetes, "servi": servi, "nu": nu}


def _battre(client, worker, capacite=4):
    return client.post(f"/api/ai/runtime/workers/{worker}/leases",
                       headers=CLE_WORKER, json={"capacite": capacite})


class TestAttribution:
    def test_un_worker_recoit_les_robots_a_couvrir(self, client, flotte):
        r = _battre(client, uniq("worker"))
        assert r.status_code == 200, r.text
        assert flotte["servi"]["id"] in r.json()["robots"]

    def test_un_robot_sans_modele_actif_n_est_pas_attribue(self, client, flotte):
        """Lui donner un worker consommerait une place pour une session inutile."""
        r = _battre(client, uniq("worker"))
        assert flotte["nu"]["id"] not in r.json()["robots"]

    def test_deux_workers_ne_se_partagent_pas_un_robot(self, client, flotte):
        premier = _battre(client, uniq("worker")).json()
        second = _battre(client, uniq("worker")).json()
        assert flotte["servi"]["id"] in premier["robots"]
        assert set(premier["robots"]).isdisjoint(second["robots"])

    def test_la_capacite_annoncee_est_respectee(self, client, flotte):
        r = _battre(client, uniq("worker"), capacite=0)
        assert r.json()["robots"] == []

    def test_le_serveur_dicte_la_cadence_de_battement(self, client, flotte):
        """Allonger le bail sans allonger le battement ferait expirer la flotte."""
        r = _battre(client, uniq("worker")).json()
        assert 0 < r["renouveler_dans"] < 45


class TestRenouvellement:
    def test_un_robot_deja_servi_reste_chez_son_worker(self, client, flotte):
        """Rééquilibrer couperait une session vidéo pour un gain théorique."""
        worker = uniq("worker")
        premier = _battre(client, worker).json()
        second = _battre(client, worker).json()
        assert premier["robots"] == second["robots"]

    def test_un_bail_expire_est_repris_par_un_autre(self, client, flotte):
        from app.database import SessionLocal
        from app.models import PerceptionLease

        mort = uniq("worker")
        assert flotte["servi"]["id"] in _battre(client, mort).json()["robots"]

        # On vieillit le bail plutôt que d'attendre quarante-cinq secondes.
        db = SessionLocal()
        bail = db.get(PerceptionLease, flotte["servi"]["id"])
        bail.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        db.close()

        repreneur = _battre(client, uniq("worker")).json()
        assert flotte["servi"]["id"] in repreneur["robots"]

    def test_rendre_ses_baux_libere_les_robots_tout_de_suite(self, client, flotte):
        worker = uniq("worker")
        _battre(client, worker)
        assert client.delete(f"/api/ai/runtime/workers/{worker}/leases",
                             headers=CLE_WORKER).status_code == 204
        repreneur = _battre(client, uniq("worker")).json()
        assert flotte["servi"]["id"] in repreneur["robots"]


class TestCouverture:
    def test_un_robot_sans_bail_apparait_decouvert(self, client, flotte):
        """La question que personne n'a pu poser le 23 septembre."""
        vue = client.get("/api/ai/perception/coverage", headers=flotte["entetes"]).json()
        decouverts = {item["robot_id"] for item in vue["decouverts"]}
        assert flotte["servi"]["id"] in decouverts

    def test_un_robot_servi_apparait_couvert_avec_son_worker(self, client, flotte):
        worker = uniq("worker")
        _battre(client, worker)
        vue = client.get("/api/ai/perception/coverage", headers=flotte["entetes"]).json()
        ligne = next(i for i in vue["couverts"] if i["robot_id"] == flotte["servi"]["id"])
        assert ligne["worker_id"] == worker
        assert worker in vue["workers"]

    def test_un_robot_sans_modele_n_est_jamais_compte_comme_decouvert(self, client, flotte):
        vue = client.get("/api/ai/perception/coverage", headers=flotte["entetes"]).json()
        tous = {i["robot_id"] for i in vue["couverts"]} | {i["robot_id"] for i in vue["decouverts"]}
        assert flotte["nu"]["id"] not in tous


class TestAcces:
    def test_sans_cle_worker_aucun_bail(self, client, flotte):
        r = client.post(f"/api/ai/runtime/workers/{uniq('worker')}/leases", json={"capacite": 4})
        assert r.status_code == 401
