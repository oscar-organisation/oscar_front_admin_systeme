"""Une Box impubliable ne doit pas pouvoir être composée.

La regle d'executabilite existait, mais n'etait verifiee qu'a la publication :
on pouvait donc assembler une Box contenant un modele qui ne tournera jamais, et
ne l'apprendre qu'au dernier clic. Le refus arrive maintenant a la composition,
avec le motif exact.
"""

import uuid

import pytest


def uniq(prefixe: str) -> str:
    return f"{prefixe}-{uuid.uuid4().hex[:8]}"


@pytest.fixture()
def contexte(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("Box"), "slug": uniq("box")}).json()
    entetes = {**admin_headers, "X-Organization-ID": org["id"]}
    return {"org": org, "entetes": entetes}


def _televerse(client, entetes, *, tache="product_detection", extension=".pt",
               promouvoir=True):
    """Import legal. Le catalogue accepte plus large que ce que le worker execute :
    huit taches a l'import, quatre executables ; cinq formats, deux runtimes."""
    nom = uniq("modele")
    runtime = {".pt": "ultralytics", ".onnx": "onnxruntime"}[extension]
    r = client.post(
        "/api/ai/models", headers=entetes,
        data={"nom": nom, "version": "1.0.0", "tache": tache,
              "framework": runtime, "runtime": runtime,
              "trusted_artifact": "true", "labels_json": '["anomalie"]'},
        files={"file": (f"{nom}{extension}", b"WEIGHTS", "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    modele = r.json()
    if promouvoir:
        assert client.post(f"/api/ai/models/{modele['id']}/promote", headers=entetes,
                           json={"statut": "production"}).status_code == 200
    return modele


def _corps_box(model_ids):
    return {
        "nom": uniq("Anomalies"), "version": "1.0.0",
        "items": [{"model_id": mid, "position": i, "inference_fps": 5, "confidence": 30,
                   "iou_threshold": 45, "overlay_enabled": True, "incident_enabled": False,
                   "camera": "front"} for i, mid in enumerate(model_ids)],
    }


def test_lapi_annonce_le_verdict_avec_chaque_modele(client, contexte):
    """L'interface doit lire la regle, pas la recopier."""
    pret = _televerse(client, contexte["entetes"])
    inapte = _televerse(client, contexte["entetes"], extension=".onnx")

    par_id = {m["id"]: m for m in client.get("/api/ai/models",
                                             headers=contexte["entetes"]).json()}
    assert par_id[pret["id"]]["deployable"] is True
    assert par_id[pret["id"]]["blocage"] is None
    assert par_id[inapte["id"]]["deployable"] is False
    assert "onnxruntime" in par_id[inapte["id"]]["blocage"]


def test_un_runtime_sans_adaptateur_est_refuse_a_la_composition(client, contexte):
    """Un .onnx s'importe legalement mais aucun adaptateur ne l'execute."""
    inapte = _televerse(client, contexte["entetes"], extension=".onnx")
    r = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                    json=_corps_box([inapte["id"]]))
    assert r.status_code == 409, r.text
    assert "onnxruntime" in r.json()["detail"]


def test_une_tache_non_executable_est_refusee(client, contexte):
    """`classification` s'importe mais le worker ne sait produire aucun overlay."""
    inapte = _televerse(client, contexte["entetes"], tache="classification")
    r = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                    json=_corps_box([inapte["id"]]))
    assert r.status_code == 409, r.text
    assert "classification" in r.json()["detail"]


def test_un_modele_resté_en_sandbox_est_refuse(client, contexte):
    sandbox = _televerse(client, contexte["entetes"], promouvoir=False)
    r = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                    json=_corps_box([sandbox["id"]]))
    assert r.status_code == 409, r.text
    assert "production" in r.json()["detail"]


def test_le_motif_nomme_le_modele_fautif_parmi_plusieurs(client, contexte):
    bon = _televerse(client, contexte["entetes"])
    mauvais = _televerse(client, contexte["entetes"], tache="segmentation")
    r = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                    json=_corps_box([bon["id"], mauvais["id"]]))
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert mauvais["nom"] in detail
    assert bon["nom"] not in detail


def test_une_box_de_modeles_executables_se_compose_et_se_publie(client, contexte):
    a = _televerse(client, contexte["entetes"], tache="product_detection")
    b = _televerse(client, contexte["entetes"], tache="incident_detection")
    box = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                      json=_corps_box([a["id"], b["id"]]))
    assert box.status_code == 201, box.text
    assert box.json()["statut"] == "draft"
    publie = client.post(f"/api/ai/model-boxes/{box.json()['id']}/publish",
                         headers=contexte["entetes"])
    assert publie.status_code == 200, publie.text
    assert publie.json()["statut"] == "published"
