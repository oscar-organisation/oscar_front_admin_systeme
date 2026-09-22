"""Distribution du paquet embarqué : de l'import jusqu'au robot.

Ces tests verrouillent ce qui distingue la distribution de code de celle d'une
configuration : rien n'atteint un robot avant publication, l'empreinte voyage
à part de l'archive, et elle est signée par la clé du robot destinataire.
"""

import hashlib
import hmac
import io
import tarfile
import uuid

import pytest

CLE_AGENT = {"X-Oscar-Agent-Key": "test-edge-agent-key"}


def uniq(prefixe: str) -> str:
    return f"{prefixe}-{uuid.uuid4().hex[:8]}"


def archive(contenu: bytes = b"paquet") -> bytes:
    """Archive minimale mais réelle : le serveur refuse ce qui n'en est pas une."""
    tampon = io.BytesIO()
    with tarfile.open(fileobj=tampon, mode="w:gz") as tar:
        info = tarfile.TarInfo("oscar-edge/VERSION")
        info.size = len(contenu)
        tar.addfile(info, io.BytesIO(contenu))
    return tampon.getvalue()


@pytest.fixture()
def contexte(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("Flotte"), "slug": uniq("flotte")}).json()
    entetes = {**admin_headers, "X-Organization-ID": org["id"]}
    robot = client.post("/api/robots", headers=entetes,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    cle = client.post(f"/api/robots/{robot['id']}/agent-key", headers=entetes).json()["agent_key"]
    return {"org": org, "entetes": entetes, "robot": robot, "cle": {"X-Oscar-Agent-Key": cle}}


# Les versions sont uniques en base pour toute la session : chaque import en
# prend une nouvelle, sauf quand le test en impose une.
_suite = iter(range(100, 999))


def _importer(client, entetes, version=None, canal="stable", donnees=None):
    version = version or f"1.0.{next(_suite)}"
    return client.post(
        "/api/edge-releases", headers=entetes,
        data={"version": version, "canal": canal, "notes": "essai"},
        files={"file": (f"oscar-edge-{version}.tar.gz", donnees or archive(), "application/gzip")},
    )


def test_une_release_importee_natteint_aucun_robot(client, contexte):
    """Importer n'est pas publier : le brouillon reste invisible du terrain."""
    r = _importer(client, contexte["entetes"])
    assert r.status_code == 201, r.text
    assert r.json()["statut"] == "draft"

    vue = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release",
                     headers=contexte["cle"])
    assert vue.status_code == 200
    assert vue.json()["release"] is None


def test_publier_expose_la_version_au_robot_avec_son_empreinte(client, contexte):
    depot = _importer(client, contexte["entetes"]).json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])

    vue = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release",
                     headers=contexte["cle"]).json()
    assert vue["release"]["version"] == depot["version"]
    assert vue["release"]["sha256"] == depot["sha256"]
    assert vue["release"]["empreinte_signee"]


def test_lempreinte_est_signee_par_la_cle_du_robot(client, contexte):
    """Un intermédiaire ne doit pas pouvoir annoncer une autre archive."""
    depot = _importer(client, contexte["entetes"]).json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])
    vue = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release",
                     headers=contexte["cle"]).json()

    empreinte_cle = hashlib.sha256(contexte["cle"]["X-Oscar-Agent-Key"].encode()).hexdigest()
    attendu = hmac.new(empreinte_cle.encode(), depot["sha256"].encode(), hashlib.sha256).hexdigest()
    assert hmac.compare_digest(vue["release"]["empreinte_signee"], attendu)


def test_un_robot_a_jour_ne_se_voit_rien_proposer(client, contexte):
    depot = _importer(client, contexte["entetes"]).json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])
    vue = client.get(
        f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release?version={depot['version']}",
        headers=contexte["cle"],
    ).json()
    assert vue["release"] is None
    assert vue["installee"] == depot["version"]


def test_larchive_telechargee_correspond_a_son_empreinte(client, contexte):
    donnees = archive(b"contenu verifiable")
    depot = _importer(client, contexte["entetes"], donnees=donnees).json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])

    r = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/archive",
                   headers=contexte["cle"])
    assert r.status_code == 200
    assert hashlib.sha256(r.content).hexdigest() == depot["sha256"]


def test_un_canal_beta_ne_touche_pas_un_robot_stable(client, contexte):
    """Le robot témoin passe d'abord ; la flotte ne bouge pas."""
    depot = _importer(client, contexte["entetes"], version="9.9.9", canal="beta").json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])
    vue = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release",
                     headers=contexte["cle"]).json()
    assert vue["canal"] == "stable"
    proposee = (vue["release"] or {}).get("version")
    assert proposee != "9.9.9"


def test_le_robot_declare_ce_quil_fait_tourner(client, contexte):
    depot = _importer(client, contexte["entetes"], version="1.2.0").json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])
    r = client.post(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
                    headers=contexte["cle"],
                    json={"version": "1.2.0", "statut": "installed", "sha256": depot["sha256"]})
    assert r.status_code == 200

    detail = client.get(f"/api/robots/{contexte['robot']['id']}", headers=contexte["entetes"]).json()
    assert detail["edge_version"] == "1.2.0"


def test_un_retour_arriere_est_enregistre_tel_quel(client, contexte):
    """Le robot a le dernier mot : la console note ce qui tourne, pas ce qu'elle voulait."""
    r = client.post(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
                    headers=contexte["cle"],
                    json={"version": "1.0.0", "statut": "rolled_back",
                          "message": "prevol en echec sur 1.2.0"})
    assert r.status_code == 200
    detail = client.get(f"/api/robots/{contexte['robot']['id']}", headers=contexte["entetes"]).json()
    assert detail["edge_version"] == "1.0.0"


def test_une_version_mal_formee_est_refusee(client, contexte):
    assert _importer(client, contexte["entetes"], version="derniere").status_code == 400


def test_deux_fois_la_meme_version_est_refuse(client, contexte):
    assert _importer(client, contexte["entetes"], version="2.0.0").status_code == 201
    assert _importer(client, contexte["entetes"], version="2.0.0").status_code == 409


def test_seule_une_archive_est_acceptee(client, contexte):
    r = client.post(
        "/api/edge-releases", headers=contexte["entetes"],
        data={"version": "3.0.0", "canal": "stable"},
        files={"file": ("paquet.zip", b"pas une archive tar", "application/zip")},
    )
    assert r.status_code == 400


def test_la_cle_dun_autre_robot_nobtient_pas_larchive(client, admin_headers, contexte):
    depot = _importer(client, contexte["entetes"], version="4.0.0").json()
    client.post(f"/api/edge-releases/{depot['id']}/publish", headers=contexte["entetes"])
    voisin = client.post("/api/robots", headers=contexte["entetes"],
                         json={"nom": uniq("VOISIN"), "org_id": contexte["org"]["id"]}).json()
    cle_voisin = client.post(f"/api/robots/{voisin['id']}/agent-key",
                             headers=contexte["entetes"]).json()["agent_key"]
    r = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/archive",
                   headers={"X-Oscar-Agent-Key": cle_voisin})
    assert r.status_code == 401


def test_un_echec_verbeux_est_enregistre_sans_faire_tomber_lappel(client, contexte):
    """Le message du démon peut faire des centaines de caractères.

    La ligne d'audit debordait alors sa colonne et l'appel repartait en 500 :
    la console n'apprenait rien de l'echec, ce qui est exactement le moment ou
    elle doit apprendre quelque chose.
    """
    motif = "image indisponible : " + ("manifest unknown " * 40)
    r = client.post(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
                    headers=contexte["cle"],
                    json={"version": "1.0.0", "statut": "failed", "message": motif})
    assert r.status_code == 200

    detail = client.get(f"/api/robots/{contexte['robot']['id']}", headers=contexte["entetes"]).json()
    assert detail["edge_version"] == "1.0.0"


def test_la_trace_dun_echec_verbeux_est_coupee_et_le_montre(client, contexte):
    client.post(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
                headers=contexte["cle"],
                json={"version": "1.0.0", "statut": "failed", "message": "x" * 600})
    journal = client.get("/api/audit?limit=5", headers=contexte["entetes"]).json()
    lignes = [l for l in (journal if isinstance(journal, list) else journal.get("items", []))
              if l.get("action") == "EDGE_RELEASE_FAILED"]
    assert lignes, "l'echec doit laisser une trace"
    assert len(lignes[0]["resource"]) <= 200
    assert lignes[0]["resource"].endswith("…")
