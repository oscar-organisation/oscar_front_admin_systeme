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


# --------------------------------------------------------------------------- #
#  Sortie du catalogue : un import rate doit pouvoir etre retire
# --------------------------------------------------------------------------- #
def test_un_modele_libre_se_supprime_avec_ses_poids(client, contexte, tmp_path):
    from pathlib import Path

    from app.database import SessionLocal
    from app.models import AiModel

    modele = _televerse(client, contexte["entetes"], promouvoir=False)
    db = SessionLocal()
    chemin = Path(db.get(AiModel, modele["id"]).fichier)
    db.close()
    assert chemin.is_file()

    r = client.delete(f"/api/ai/models/{modele['id']}", headers=contexte["entetes"])
    assert r.status_code == 204, r.text
    assert not chemin.exists(), "les poids doivent partir avec l'enregistrement"
    ids = {m["id"] for m in client.get("/api/ai/models", headers=contexte["entetes"]).json()}
    assert modele["id"] not in ids


def test_un_modele_utilise_par_une_box_ne_se_supprime_pas(client, contexte):
    """Casser une composition en silence serait pire que refuser."""
    a = _televerse(client, contexte["entetes"], tache="product_detection")
    box = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                      json=_corps_box([a["id"]]))
    assert box.status_code == 201, box.text

    r = client.delete(f"/api/ai/models/{a['id']}", headers=contexte["entetes"])
    assert r.status_code == 409, r.text
    assert box.json()["nom"] in r.json()["detail"]


def test_apres_retrait_de_la_box_le_modele_se_supprime(client, contexte):
    a = _televerse(client, contexte["entetes"], tache="product_detection")
    b = _televerse(client, contexte["entetes"], tache="incident_detection")
    box = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                      json=_corps_box([a["id"], b["id"]])).json()

    maj = client.patch(f"/api/ai/model-boxes/{box['id']}", headers=contexte["entetes"],
                       json={"nom": box["nom"], "version": box["version"],
                             "items": [{"model_id": b["id"], "position": 0}]})
    assert maj.status_code == 200, maj.text
    assert client.delete(f"/api/ai/models/{a['id']}",
                         headers=contexte["entetes"]).status_code == 204


def test_modifier_une_box_en_gardant_un_modele(client, contexte):
    """Regression : la contrainte d'unicite des items sautait au remplacement."""
    a = _televerse(client, contexte["entetes"], tache="product_detection")
    b = _televerse(client, contexte["entetes"], tache="incident_detection")
    box = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                      json=_corps_box([a["id"], b["id"]])).json()

    # Meme nom, meme version, meme premier modele : seul le second disparait.
    maj = client.patch(f"/api/ai/model-boxes/{box['id']}", headers=contexte["entetes"],
                       json={"nom": box["nom"], "version": box["version"],
                             "items": [{"model_id": a["id"], "position": 0}]})
    assert maj.status_code == 200, maj.text
    assert [item["model_id"] for item in maj.json()["items"]] == [a["id"]]


def test_limport_et_la_promotion_annoncent_le_verdict(client, contexte):
    """Regression : ces deux reponses renvoyaient `deployable=False` sans motif.

    Le verdict n'etait calcule que dans la liste ; juste apres un import reussi,
    l'interface voyait donc un modele « non deployable » sans explication.
    """
    nom = uniq("modele")
    r = client.post(
        "/api/ai/models", headers=contexte["entetes"],
        data={"nom": nom, "version": "1.0.0", "tache": "object_detection",
              "framework": "ultralytics", "runtime": "ultralytics",
              "trusted_artifact": "true", "labels_json": '["bottle"]'},
        files={"file": (f"{nom}.pt", b"WEIGHTS", "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    assert r.json()["deployable"] is False
    assert "production" in r.json()["blocage"]

    promu = client.post(f"/api/ai/models/{r.json()['id']}/promote", headers=contexte["entetes"],
                        json={"statut": "production"})
    assert promu.status_code == 200, promu.text
    assert promu.json()["deployable"] is True
    assert promu.json()["blocage"] is None


def test_un_modele_didentification_se_compose_avec_un_detecteur(client, contexte):
    """Le second etage s'importe en PyTorch natif et vit dans la meme Box que
    le detecteur dont il nomme les produits."""
    detecteur = _televerse(client, contexte["entetes"], tache="product_detection")
    nom = uniq("identification")
    r = client.post(
        "/api/ai/models", headers=contexte["entetes"],
        data={"nom": nom, "version": "1.0.0", "tache": "product_identification",
              "framework": "pytorch", "runtime": "pytorch", "trusted_artifact": "true",
              "labels_json": "[]"},
        files={"file": (f"{nom}.pt", b"GALERIE", "application/octet-stream")},
    )
    assert r.status_code == 201, r.text
    ident = r.json()
    assert client.post(f"/api/ai/models/{ident['id']}/promote", headers=contexte["entetes"],
                       json={"statut": "production"}).json()["deployable"] is True
    box = client.post("/api/ai/model-boxes", headers=contexte["entetes"],
                      json=_corps_box([detecteur["id"], ident["id"]]))
    assert box.status_code == 201, box.text
    assert client.post(f"/api/ai/model-boxes/{box.json()['id']}/publish",
                       headers=contexte["entetes"]).status_code == 200
