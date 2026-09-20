"""Cycle de vie d'un bundle : composer, publier, déployer, rendre compte.

Ces tests verrouillent les frontières du Studio côté serveur : une version
publiée est figée, un robot d'une autre organisation n'est pas une cible, et
ce que le robot déclare avoir appliqué doit correspondre à ce qui a été publié.
"""

import uuid

import pytest

CLE_AGENT = {"X-Oscar-Agent-Key": "test-edge-agent-key"}


def uniq(prefixe: str) -> str:
    return f"{prefixe}-{uuid.uuid4().hex[:8]}"


def spec(code_canal_sortie: str = "CANAL_EMISSION_ETAT") -> dict:
    """Composition minimale valide : un bundle, un service, un agent, deux canaux."""
    return {
        "nodes": [
            {"id": "b1", "position": {"x": 0, "y": 0}, "data": {
                "kind": "BUNDLE_DEPLOIEMENT", "name": "Bundle test",
                "technicalCode": "BUNDLE_DEPLOIEMENT_TEST",
                "target": "ENVIRONNEMENT_EXECUTION_ROBOT", "agents": [],
            }},
            {"id": "s1", "position": {"x": 400, "y": 0}, "data": {
                "kind": "INSTANCE_SERVICE", "name": "Service test",
                "technicalCode": "INSTANCE_SERVICE_TEST",
                "target": "ENVIRONNEMENT_EXECUTION_ROBOT",
                "agents": [{
                    "id": "a1", "name": "Agent test",
                    "technicalCode": "INSTANCE_AGENT_TEST",
                    "agentType": "TYPE_AGENT_STANDARD",
                    "processingName": "TRAITEMENT_METIER_AGENT_PRINCIPAL",
                    "interfaceName": "INTERFACE_COMMUNICATION_AGENT_PRINCIPALE",
                    "dataBandName": "BANDE_DONNEES_PRINCIPALE",
                    "receiveBusName": "BUS_RECEPTION_PRINCIPAL",
                    "sendBusName": "BUS_EMISSION_PRINCIPAL",
                    "canPublishAudio": False, "canPublishVideo": True,
                    "inputs": [{
                        "id": "rx1", "name": "Commande", "direction": "RECEPTION",
                        "technicalCode": "CANAL_RECEPTION_COMMANDE",
                        "channelType": "TYPE_ENTREE_ABONNEMENT_TEMPS_REEL",
                        "dataFormat": "OBJET_JSON",
                    }],
                    "outputs": [{
                        "id": "tx1", "name": "État", "direction": "EMISSION",
                        "technicalCode": code_canal_sortie,
                        "channelType": "TYPE_SORTIE_PUBLICATION_TEMPS_REEL_CANAL_AGENT",
                        "dataFormat": "OBJET_JSON",
                    }],
                }],
            }},
        ],
        "edges": [],
    }


@pytest.fixture()
def contexte(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("Studio"), "slug": uniq("studio")}).json()
    entetes = {**admin_headers, "X-Organization-ID": org["id"]}
    robot = client.post("/api/robots", headers=entetes,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    bundle = client.post("/api/studio/bundles", headers=entetes,
                         json={"nom": uniq("Bundle magasin"),
                               "description": "Composition de test"}).json()
    return {"org": org, "entetes": entetes, "robot": robot, "bundle": bundle}


def _publier(client, contexte, composition=None):
    bundle_id = contexte["bundle"]["id"]
    r = client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
                   json={"spec": composition or spec()})
    assert r.status_code == 200, r.text
    r = client.post(f"/api/studio/bundles/{bundle_id}/publish", headers=contexte["entetes"],
                    json={"notes": "version de test"})
    assert r.status_code == 200, r.text
    return r.json()


def test_un_robot_recoit_un_identifiant_terrain(client, contexte):
    """L'agent embarqué ne connaît pas les UUID : il lui faut un slug."""
    robot = contexte["robot"]
    assert robot["slug"]
    assert robot["slug"] == robot["slug"].lower()
    assert 3 <= len(robot["slug"]) <= 63


def test_publier_refuse_une_composition_invalide(client, contexte):
    bundle_id = contexte["bundle"]["id"]
    sans_bundle = spec()
    sans_bundle["nodes"] = sans_bundle["nodes"][1:]
    client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
               json={"spec": sans_bundle})

    verif = client.post(f"/api/studio/bundles/{bundle_id}/validate", headers=contexte["entetes"])
    assert verif.status_code == 200
    assert verif.json()["valide"] is False

    r = client.post(f"/api/studio/bundles/{bundle_id}/publish", headers=contexte["entetes"], json={})
    assert r.status_code == 409
    assert "bundle de déploiement" in r.json()["detail"]


def test_les_doublons_didentifiant_technique_bloquent_la_publication(client, contexte):
    """Deux canaux de même code produiraient deux abonnements indiscernables."""
    bundle_id = contexte["bundle"]["id"]
    duplique = spec(code_canal_sortie="CANAL_RECEPTION_COMMANDE")
    client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
               json={"spec": duplique})
    r = client.post(f"/api/studio/bundles/{bundle_id}/publish", headers=contexte["entetes"], json={})
    assert r.status_code == 409
    assert "dupliqué" in r.json()["detail"]


def test_une_version_publiee_est_figee_et_la_suivante_repart_en_brouillon(client, contexte):
    bundle_id = contexte["bundle"]["id"]
    v1 = _publier(client, contexte)
    assert v1["numero"] == 1 and v1["statut"] == "published" and v1["checksum"]

    client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
               json={"spec": spec(code_canal_sortie="CANAL_EMISSION_ETAT_V2")})
    detail = client.get(f"/api/studio/bundles/{bundle_id}", headers=contexte["entetes"]).json()
    assert detail["published_version"]["numero"] == 1
    assert detail["draft_version"]["numero"] == 2


def test_deplacer_un_bloc_ne_change_pas_lempreinte(client, contexte):
    """L'empreinte porte sur ce qui s'exécute, pas sur la mise en page."""
    bundle_id = contexte["bundle"]["id"]
    initiale = client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
                          json={"spec": spec()}).json()["checksum"]
    deplace = spec()
    deplace["nodes"][1]["position"] = {"x": 999, "y": 512}
    apres = client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
                       json={"spec": deplace}).json()["checksum"]
    assert apres == initiale

    renomme = spec(code_canal_sortie="CANAL_EMISSION_AUTRE")
    autre = client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
                       json={"spec": renomme}).json()["checksum"]
    assert autre != initiale


def test_seule_une_version_publiee_se_deploie(client, contexte):
    bundle_id = contexte["bundle"]["id"]
    brouillon = client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
                           json={"spec": spec()}).json()
    r = client.post("/api/studio/deployments", headers=contexte["entetes"],
                    json={"version_id": brouillon["id"], "robot_ids": [contexte["robot"]["id"]]})
    assert r.status_code == 409


def test_un_deploiement_remplace_le_precedent_sans_leffacer(client, contexte):
    version = _publier(client, contexte)
    robot_id = contexte["robot"]["id"]
    for _ in range(2):
        r = client.post("/api/studio/deployments", headers=contexte["entetes"],
                        json={"version_id": version["id"], "robot_ids": [robot_id]})
        assert r.status_code == 201, r.text

    lignes = client.get(f"/api/studio/deployments?robot_id={robot_id}",
                        headers=contexte["entetes"]).json()
    assert len(lignes) == 2
    assert [ligne["statut"] for ligne in lignes] == ["pending", "superseded"]


def test_le_robot_tire_son_manifeste_puis_rend_compte(client, contexte):
    version = _publier(client, contexte)
    robot = contexte["robot"]
    client.post("/api/studio/deployments", headers=contexte["entetes"],
                json={"version_id": version["id"], "robot_ids": [robot["id"]]})

    # L'agent s'adresse au robot par son slug, jamais par son UUID.
    r = client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle", headers=CLE_AGENT)
    assert r.status_code == 200, r.text
    charge = r.json()
    assert charge["format"] == "oscar.bundle.runtime.v1"
    assert charge["deployment"]["statut"] == "delivered"
    assert charge["deployment"]["checksum"] == version["checksum"]
    codes = [composant["code"] for composant in charge["manifest"]["composants"]]
    assert codes == ["INSTANCE_SERVICE_TEST"]
    # La mise en page ne traverse pas : le robot ne reçoit pas un plan.
    assert "position" not in str(charge["manifest"])

    rapport = client.post(
        f"/api/studio/runtime/robots/{robot['slug']}/bundle/report", headers=CLE_AGENT,
        json={"deployment_id": charge["deployment"]["id"], "statut": "active",
              "checksum": charge["deployment"]["checksum"], "report": {"conteneurs": 1}},
    )
    assert rapport.status_code == 200, rapport.text
    ligne = client.get(f"/api/studio/deployments?robot_id={robot['id']}",
                       headers=contexte["entetes"]).json()[0]
    assert ligne["statut"] == "active"
    assert ligne["applied_at"]


def test_un_compte_rendu_dempreinte_inattendue_est_un_echec(client, contexte):
    """Le robot déclare autre chose que ce qui a été publié : on ne valide pas."""
    version = _publier(client, contexte)
    robot = contexte["robot"]
    client.post("/api/studio/deployments", headers=contexte["entetes"],
                json={"version_id": version["id"], "robot_ids": [robot["id"]]})
    charge = client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                        headers=CLE_AGENT).json()

    r = client.post(
        f"/api/studio/runtime/robots/{robot['slug']}/bundle/report", headers=CLE_AGENT,
        json={"deployment_id": charge["deployment"]["id"], "statut": "active",
              "checksum": "0" * 64},
    )
    assert r.status_code == 409
    ligne = client.get(f"/api/studio/deployments?robot_id={robot['id']}",
                       headers=contexte["entetes"]).json()[0]
    assert ligne["statut"] == "failed"


def test_lagent_sans_cle_nobtient_rien(client, contexte):
    robot = contexte["robot"]
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle").status_code == 401
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers={"X-Oscar-Agent-Key": "mauvaise-cle"}).status_code == 401


def test_un_bundle_dune_autre_organisation_reste_invisible(client, admin_headers, contexte):
    voisine = client.post("/api/organisations", headers=admin_headers,
                          json={"nom": uniq("Voisine"), "slug": uniq("voisine")}).json()
    entetes_voisins = {**admin_headers, "X-Organization-ID": voisine["id"]}
    bundle_id = contexte["bundle"]["id"]

    assert client.get(f"/api/studio/bundles/{bundle_id}", headers=entetes_voisins).status_code == 404
    listes = client.get("/api/studio/bundles", headers=entetes_voisins).json()
    assert all(item["id"] != bundle_id for item in listes)


def test_un_robot_dune_autre_organisation_nest_pas_une_cible(client, admin_headers, contexte):
    voisine = client.post("/api/organisations", headers=admin_headers,
                          json={"nom": uniq("Voisine"), "slug": uniq("voisine")}).json()
    robot_voisin = client.post("/api/robots", headers={**admin_headers, "X-Organization-ID": voisine["id"]},
                               json={"nom": uniq("INTRUS"), "org_id": voisine["id"]}).json()
    version = _publier(client, contexte)

    r = client.post("/api/studio/deployments", headers=contexte["entetes"],
                    json={"version_id": version["id"], "robot_ids": [robot_voisin["id"]]})
    assert r.status_code == 404


def test_un_bundle_deja_deploye_ne_se_supprime_pas(client, contexte):
    version = _publier(client, contexte)
    client.post("/api/studio/deployments", headers=contexte["entetes"],
                json={"version_id": version["id"], "robot_ids": [contexte["robot"]["id"]]})
    r = client.delete(f"/api/studio/bundles/{contexte['bundle']['id']}", headers=contexte["entetes"])
    assert r.status_code == 409
    assert "archivez" in r.json()["detail"]


def test_configuration_preparee_nest_pas_execution_active(client, contexte):
    version = _publier(client, contexte)
    robot = contexte["robot"]
    deployment = client.post("/api/studio/deployments", headers=contexte["entetes"],
        json={"version_id": version["id"], "robot_ids": [robot["id"]]}).json()[0]
    r = client.post(f"/api/studio/runtime/robots/{robot['slug']}/bundle/report", headers=CLE_AGENT,
        json={"deployment_id": deployment["id"], "statut": "prepared", "checksum": version["checksum"]})
    assert r.status_code == 200, r.text
    actuel = client.get(f"/api/studio/deployments?robot_id={robot['id']}", headers=contexte["entetes"]).json()[0]
    assert actuel["statut"] == "prepared"
    assert actuel["applied_at"] is None
    desired = client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle", headers=CLE_AGENT).json()
    assert desired["deployment"]["id"] == deployment["id"]


def test_un_rapport_ne_ressuscite_pas_un_deploiement_remplace(client, contexte):
    version = _publier(client, contexte)
    robot = contexte["robot"]
    body = {"version_id": version["id"], "robot_ids": [robot["id"]]}
    ancien = client.post("/api/studio/deployments", headers=contexte["entetes"], json=body).json()[0]
    client.post("/api/studio/deployments", headers=contexte["entetes"], json=body)
    r = client.post(f"/api/studio/runtime/robots/{robot['slug']}/bundle/report", headers=CLE_AGENT,
        json={"deployment_id": ancien["id"], "statut": "active", "checksum": version["checksum"]})
    assert r.status_code == 409


def test_un_rapport_sans_empreinte_est_refuse(client, contexte):
    version = _publier(client, contexte)
    robot = contexte["robot"]
    deployment = client.post("/api/studio/deployments", headers=contexte["entetes"],
        json={"version_id": version["id"], "robot_ids": [robot["id"]]}).json()[0]
    r = client.post(f"/api/studio/runtime/robots/{robot['slug']}/bundle/report", headers=CLE_AGENT,
        json={"deployment_id": deployment["id"], "statut": "active"})
    assert r.status_code == 409


def test_revision_edition_protege_aussi_les_positions(client, contexte):
    url = f"/api/studio/bundles/{contexte['bundle']['id']}"
    initial = client.put(url + "/draft", headers=contexte["entetes"], json={"spec": spec()}).json()
    change = spec()
    change["nodes"][0]["position"]["x"] = 100
    suivant = client.put(url + "/draft", headers=contexte["entetes"],
        json={"spec": change, "expected_revision": initial["editing_revision"]}).json()
    assert suivant["checksum"] == initial["checksum"]
    assert suivant["editing_revision"] != initial["editing_revision"]
    assert client.put(url + "/draft", headers=contexte["entetes"],
        json={"spec": spec(), "expected_revision": initial["editing_revision"]}).status_code == 409
    assert client.post(url + "/publish", headers=contexte["entetes"],
        json={"expected_revision": initial["editing_revision"]}).status_code == 409


def test_structure_malformee_refusee_sans_erreur_serveur(client, contexte):
    invalide = spec()
    invalide["nodes"][1]["data"]["technicalCode"] = {"invalide": True}
    r = client.put(f"/api/studio/bundles/{contexte['bundle']['id']}/draft",
        headers=contexte["entetes"], json={"spec": invalide})
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
#  Clés d'agent propres à chaque robot
# --------------------------------------------------------------------------- #
def _emettre_cle(client, entetes, robot_id):
    r = client.post(f"/api/robots/{robot_id}/agent-key", headers=entetes)
    assert r.status_code == 200, r.text
    return r.json()["agent_key"]


def test_la_cle_dun_robot_ne_vaut_que_pour_lui(client, admin_headers, contexte):
    """Un robot compromis ne doit pas pouvoir parler au nom de ses voisins."""
    voisin = client.post("/api/robots", headers=contexte["entetes"],
                         json={"nom": uniq("OSCAR"), "org_id": contexte["org"]["id"]}).json()
    cle_voisin = _emettre_cle(client, contexte["entetes"], voisin["id"])
    cible = contexte["robot"]
    _emettre_cle(client, contexte["entetes"], cible["id"])

    r = client.get(f"/api/studio/runtime/robots/{cible['slug']}/bundle",
                   headers={"X-Oscar-Agent-Key": cle_voisin})
    assert r.status_code == 401

    r = client.get(f"/api/studio/runtime/robots/{voisin['slug']}/bundle",
                   headers={"X-Oscar-Agent-Key": cle_voisin})
    assert r.status_code == 200


def test_une_cle_emise_rend_la_cle_de_flotte_inoperante(client, contexte):
    """La transition s'arrête pour un robot dès qu'il a la sienne."""
    robot = contexte["robot"]
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers=CLE_AGENT).status_code == 200  # cle de flotte, encore acceptee

    cle = _emettre_cle(client, contexte["entetes"], robot["id"])
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers=CLE_AGENT).status_code == 401
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers={"X-Oscar-Agent-Key": cle}).status_code == 200


def test_reemettre_revoque_la_cle_precedente(client, contexte):
    robot = contexte["robot"]
    ancienne = _emettre_cle(client, contexte["entetes"], robot["id"])
    nouvelle = _emettre_cle(client, contexte["entetes"], robot["id"])
    assert ancienne != nouvelle
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers={"X-Oscar-Agent-Key": ancienne}).status_code == 401
    assert client.get(f"/api/studio/runtime/robots/{robot['slug']}/bundle",
                      headers={"X-Oscar-Agent-Key": nouvelle}).status_code == 200


def test_sans_cle_aucune_resolution_de_robot(client, contexte):
    """Sans clé, l'API ne dit même pas si ce robot existe."""
    r = client.get(f"/api/studio/runtime/robots/{contexte['robot']['slug']}/bundle")
    assert r.status_code == 401
    r = client.get("/api/studio/runtime/robots/robot-qui-nexiste-pas/bundle")
    assert r.status_code == 401


def test_la_cle_nest_jamais_relisible(client, contexte):
    """Le serveur ne garde que l'empreinte : la clé ne se relit pas."""
    robot = contexte["robot"]
    cle = _emettre_cle(client, contexte["entetes"], robot["id"])
    detail = client.get(f"/api/robots/{robot['id']}", headers=contexte["entetes"])
    assert detail.status_code == 200
    assert cle not in detail.text
    assert "agent_key" not in detail.json()


def test_un_robot_dune_autre_organisation_ne_recoit_pas_de_cle(client, admin_headers, contexte):
    voisine = client.post("/api/organisations", headers=admin_headers,
                          json={"nom": uniq("Voisine"), "slug": uniq("voisine")}).json()
    entetes_voisins = {**admin_headers, "X-Organization-ID": voisine["id"]}
    r = client.post(f"/api/robots/{contexte['robot']['id']}/agent-key", headers=entetes_voisins)
    assert r.status_code == 404


def test_lenrolement_livre_les_deux_identites_du_runtime(client, contexte):
    """Média et commande sont deux participants : une seule identité et le
    second évince le premier à chaque connexion."""
    r = client.post(f"/api/robots/{contexte['robot']['id']}/edge-credentials",
                    headers=contexte["entetes"])
    assert r.status_code == 200, r.text
    corps = r.json()
    fichiers = corps["fichiers"]
    assert set(fichiers) == {"/etc/oscar/credentials/media.json",
                             "/etc/oscar/credentials/command.json"}
    identites = {chemin: contenu["livekit"]["identity"] for chemin, contenu in fichiers.items()}
    assert len(set(identites.values())) == 2
    salles = {contenu["livekit"]["roomName"] for contenu in fichiers.values()}
    assert len(salles) == 1  # meme room, sinon les deux agents ne se rejoignent pas
    for contenu in fichiers.values():
        for cle in ("serverUrl", "roomName", "identity", "token"):
            assert contenu["livekit"][cle]


def test_lenrolement_dun_robot_voisin_est_refuse(client, admin_headers, contexte):
    voisine = client.post("/api/organisations", headers=admin_headers,
                          json={"nom": uniq("Voisine"), "slug": uniq("voisine")}).json()
    r = client.post(f"/api/robots/{contexte['robot']['id']}/edge-credentials",
                    headers={**admin_headers, "X-Organization-ID": voisine["id"]})
    assert r.status_code == 404
