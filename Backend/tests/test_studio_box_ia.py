"""Une version de bundle emporte sa Box IA.

Avant, deployer un robot demandait deux gestes : pousser la composition, puis
se souvenir d'affecter la bonne Box de modeles. Le second s'oubliait. La
version publiee porte maintenant la Box, et le deploiement aligne le robot
dessus.
"""

import uuid

import pytest

from tests.test_studio_bundles import spec, uniq


@pytest.fixture()
def contexte(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("BoxIA"), "slug": uniq("boxia")}).json()
    entetes = {**admin_headers, "X-Organization-ID": org["id"]}
    robot = client.post("/api/robots", headers=entetes,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    bundle = client.post("/api/studio/bundles", headers=entetes,
                         json={"nom": uniq("Perception")}).json()
    return {"org": org, "entetes": entetes, "robot": robot, "bundle": bundle}


def _box_publiee(client, entetes, *, publier=True):
    """Box minimale : un modele deployable, puis publication."""
    nom = uniq("modele")
    r = client.post(
        "/api/ai/models", headers=entetes,
        data={"nom": nom, "version": "1.0.0", "tache": "product_detection",
              "framework": "ultralytics", "runtime": "ultralytics",
              "trusted_artifact": "true", "labels_json": '["anomalie"]'},
        files={"file": (f"{nom}.pt", b"WEIGHTS", "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    modele = r.json()
    client.post(f"/api/ai/models/{modele['id']}/promote", headers=entetes,
                json={"statut": "production"})
    box = client.post("/api/ai/model-boxes", headers=entetes, json={
        "nom": uniq("Box"), "version": "1.0.0",
        "items": [{"model_id": modele["id"], "position": 0}],
    }).json()
    if publier:
        r = client.post(f"/api/ai/model-boxes/{box['id']}/publish", headers=entetes)
        assert r.status_code == 200, r.text
    return box


def _composition_avec_box(box_id: str | None):
    composition = spec()
    if box_id:
        composition["nodes"][1]["data"]["aiBoxId"] = box_id
    return composition


def _publier(client, contexte, composition):
    bundle_id = contexte["bundle"]["id"]
    client.put(f"/api/studio/bundles/{bundle_id}/draft", headers=contexte["entetes"],
               json={"spec": composition})
    return client.post(f"/api/studio/bundles/{bundle_id}/publish", headers=contexte["entetes"],
                       json={})


def test_une_box_en_brouillon_bloque_la_publication(client, contexte):
    box = _box_publiee(client, contexte["entetes"], publier=False)
    r = _publier(client, contexte, _composition_avec_box(box["id"]))
    assert r.status_code == 409
    assert "non publiée" in r.json()["detail"]


def test_une_box_inconnue_bloque_la_publication(client, contexte):
    r = _publier(client, contexte, _composition_avec_box(uuid.uuid4().hex))
    assert r.status_code == 409
    assert "introuvable" in r.json()["detail"]


def test_une_box_dune_autre_organisation_bloque_la_publication(client, admin_headers, contexte):
    voisine = client.post("/api/organisations", headers=admin_headers,
                          json={"nom": uniq("Voisine"), "slug": uniq("voisine")}).json()
    box = _box_publiee(client, {**admin_headers, "X-Organization-ID": voisine["id"]})
    r = _publier(client, contexte, _composition_avec_box(box["id"]))
    assert r.status_code == 409
    assert "autre organisation" in r.json()["detail"]


def test_deployer_active_la_box_declaree_sur_le_robot(client, contexte):
    box = _box_publiee(client, contexte["entetes"])
    version = _publier(client, contexte, _composition_avec_box(box["id"])).json()
    r = client.post("/api/studio/deployments", headers=contexte["entetes"],
                    json={"version_id": version["id"], "robot_ids": [contexte["robot"]["id"]]})
    assert r.status_code == 201, r.text

    assignations = client.get("/api/ai/model-box-assignments", headers=contexte["entetes"]).json()
    actives = [a for a in assignations
               if a["robot_id"] == contexte["robot"]["id"] and a["enabled"]]
    assert [a["box_id"] for a in actives] == [box["id"]]


def test_une_version_sans_box_desactive_celle_qui_tournait(client, contexte):
    """Le bundle est la source de verite : ce qu'il ne declare plus s'arrete."""
    box = _box_publiee(client, contexte["entetes"])
    avec = _publier(client, contexte, _composition_avec_box(box["id"])).json()
    client.post("/api/studio/deployments", headers=contexte["entetes"],
                json={"version_id": avec["id"], "robot_ids": [contexte["robot"]["id"]]})

    sans = _publier(client, contexte, _composition_avec_box(None)).json()
    client.post("/api/studio/deployments", headers=contexte["entetes"],
                json={"version_id": sans["id"], "robot_ids": [contexte["robot"]["id"]]})

    assignations = client.get("/api/ai/model-box-assignments", headers=contexte["entetes"]).json()
    pour_ce_robot = [a for a in assignations if a["robot_id"] == contexte["robot"]["id"]]
    assert pour_ce_robot and all(not a["enabled"] for a in pour_ce_robot)


def test_le_manifeste_servi_au_robot_nomme_la_box(client, contexte):
    box = _box_publiee(client, contexte["entetes"])
    version = _publier(client, contexte, _composition_avec_box(box["id"])).json()
    manifeste = client.get(f"/api/studio/versions/{version['id']}/manifest",
                           headers=contexte["entetes"]).json()["manifest"]
    composants = [c for c in manifeste["composants"] if c.get("box_ia")]
    assert [c["box_ia"] for c in composants] == [box["id"]]
