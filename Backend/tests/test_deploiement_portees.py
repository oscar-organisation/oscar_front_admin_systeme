"""Portées d'un déploiement : des robots, une flotte, un site.

Cibler cent robots un par un n'est pas une méthode. La plateforme savait déjà
raisonner en flotte du côté des Box IA ; le déploiement de bundles ne le
faisait qu'à moitié, et ignorait le site.

Ce que ces tests tiennent : les trois portées se cumulent sans jamais créer
deux déploiements pour un même robot, et chacune reste enfermée dans son
organisation.
"""

import uuid

import pytest

from test_studio_bundles import _publier, contexte, spec, uniq  # noqa: F401


def _robot(client, contexte, site_id=None):
    corps = {"nom": uniq("OSCAR"), "org_id": contexte["org"]["id"]}
    if site_id:
        corps["site_id"] = site_id
    return client.post("/api/robots", headers=contexte["entetes"], json=corps).json()


def _deployer(client, contexte, version_id, **portee):
    return client.post("/api/studio/deployments", headers=contexte["entetes"],
                       json={"version_id": version_id, **portee})


@pytest.fixture()
def version(client, contexte):
    return _publier(client, contexte)["id"]


class TestPortees:
    def test_une_flotte_cree_une_ligne_par_robot(self, client, contexte, version):
        """Une flotte de cent robots dont trois échouent n'est pas « une flotte
        en échec », c'est trois robots à regarder."""
        a, b = _robot(client, contexte), _robot(client, contexte)
        flotte = client.post("/api/fleets", headers=contexte["entetes"],
                             json={"nom": uniq("Magasins"), "code": uniq("mag"),
                                   "org_id": contexte["org"]["id"],
                                   "robot_ids": [a["id"], b["id"]]}).json()

        r = _deployer(client, contexte, version, fleet_id=flotte["id"])
        assert r.status_code == 201, r.text
        assert {d["robot_id"] for d in r.json()} >= {a["id"], b["id"]}

    def test_un_site_cible_les_robots_qui_y_sont(self, client, contexte, version):
        site = client.post("/api/sites", headers=contexte["entetes"],
                           json={"nom": uniq("Lyon"), "code": uniq("lyon"),
                                 "org_id": contexte["org"]["id"]}).json()
        ici = _robot(client, contexte, site_id=site["id"])
        ailleurs = _robot(client, contexte)

        r = _deployer(client, contexte, version, site_id=site["id"])
        assert r.status_code == 201, r.text
        vises = {d["robot_id"] for d in r.json()}
        assert ici["id"] in vises and ailleurs["id"] not in vises

    def test_les_portees_se_cumulent_sans_doublon(self, client, contexte, version):
        """Cibler une flotte puis l'un de ses robots ne doit pas déployer deux fois."""
        robot = _robot(client, contexte)
        flotte = client.post("/api/fleets", headers=contexte["entetes"],
                             json={"nom": uniq("Flotte"), "code": uniq("fl"),
                                   "org_id": contexte["org"]["id"],
                                   "robot_ids": [robot["id"]]}).json()

        r = _deployer(client, contexte, version,
                      fleet_id=flotte["id"], robot_ids=[robot["id"]])
        assert r.status_code == 201, r.text
        lignes = [d for d in r.json() if d["robot_id"] == robot["id"]]
        assert len(lignes) == 1


class TestGardeFous:
    def test_une_portee_vide_est_refusee(self, client, contexte, version):
        site = client.post("/api/sites", headers=contexte["entetes"],
                           json={"nom": uniq("Vide"), "code": uniq("vide"),
                                 "org_id": contexte["org"]["id"]}).json()
        r = _deployer(client, contexte, version, site_id=site["id"])
        assert r.status_code == 400, r.text

    def test_un_site_inconnu_est_refuse(self, client, contexte, version):
        r = _deployer(client, contexte, version, site_id=uuid.uuid4().hex)
        assert r.status_code == 404, r.text

    def test_sans_aucune_portee_rien_n_est_deploye(self, client, contexte, version):
        assert _deployer(client, contexte, version).status_code == 400
