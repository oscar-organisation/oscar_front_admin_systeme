"""Full tests API Centrale - couvre auth, RBAC, les 6 modules, jetons LiveKit, audit."""
import os
import uuid

from jose import jwt


def livekit_secret() -> str:
    return os.environ["LIVEKIT_API_SECRET"]


def uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- #
#  Santé & Auth
# --------------------------------------------------------------------------- #
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_login_and_me(client, admin_headers):
    r = client.get("/api/auth/me", headers=admin_headers)
    assert r.status_code == 200
    me = r.json()
    assert me["is_superadmin"] is True
    assert "api:org.write" in me["features"]         # superadmin voit tout
    assert "ui:cockpit.page" in me["features"]
    assert "create" in me["permissions"]["api:org.write"]


def test_system_roles_receive_new_cockpit_permission(client):
    from app.database import SessionLocal
    from app.models import Feature, Role, RolePermission

    db = SessionLocal()
    try:
        rows = db.query(Role.nom).join(RolePermission, Role.id == RolePermission.role_id) \
            .join(Feature, Feature.id == RolePermission.feature_id) \
            .filter(Feature.code == "ui:cockpit.page").all()
        roles = {name for (name,) in rows}
    finally:
        db.close()

    assert "Opérateur XR" in roles
    assert "Opérateur 2D" not in roles


def test_login_bad_password(client):
    r = client.post("/api/auth/login", json={"email": "admin@oscar.fr", "password": "WRONG"})
    assert r.status_code == 401


def test_me_requires_auth(client):
    r = client.get("/api/auth/me")
    assert r.status_code in (401, 403)


# --------------------------------------------------------------------------- #
#  Organisations (A) + Sites (B)
# --------------------------------------------------------------------------- #
def test_org_crud(client, admin_headers):
    r = client.post("/api/organisations", headers=admin_headers,
                    json={"nom": "Test Org", "slug": uniq("test-org")})
    assert r.status_code == 201, r.text
    oid = r.json()["id"]

    assert any(o["id"] == oid for o in client.get("/api/organisations", headers=admin_headers).json())

    r = client.patch(f"/api/organisations/{oid}", headers=admin_headers,
                     json={"nom": "Test Org 2", "slug": r.json()["slug"]})
    assert r.status_code == 200 and r.json()["nom"] == "Test Org 2"

    assert client.delete(f"/api/organisations/{oid}", headers=admin_headers).status_code == 204
    assert client.get(f"/api/organisations/{oid}", headers=admin_headers).status_code == 404


def test_site_crud(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "OrgSite", "slug": uniq("orgsite")}).json()
    r = client.post("/api/sites", headers=admin_headers,
                    json={"org_id": org["id"], "nom": "Magasin X", "code": uniq("FR-X"),
                          "zones": ["A", "B"]})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    lst = client.get(f"/api/sites?org_id={org['id']}", headers=admin_headers).json()
    assert any(s["id"] == sid for s in lst)
    assert client.delete(f"/api/sites/{sid}", headers=admin_headers).status_code == 204


# --------------------------------------------------------------------------- #
#  Utilisateurs (C) + Rôles/permissions (D)
# --------------------------------------------------------------------------- #
def test_features_catalog(client, admin_headers):
    feats = client.get("/api/features", headers=admin_headers).json()
    assert len(feats) > 20
    types = {f["type"] for f in feats}
    assert types == {"api", "ui"}


def test_role_permissions_and_detail(client, admin_headers):
    role = client.post("/api/roles", headers=admin_headers,
                       json={"nom": uniq("role")}).json()
    body = [
        {"feature_code": "api:org.read", "actions": ["view"]},
        {"feature_code": "ui:orgs.page", "actions": ["view"]},
    ]
    r = client.put(f"/api/roles/{role['id']}/permissions", headers=admin_headers, json=body)
    assert r.status_code == 200, r.text
    detail = client.get(f"/api/roles/{role['id']}", headers=admin_headers).json()
    codes = {p["feature_code"] for p in detail["permissions"]}
    assert codes == {"api:org.read", "ui:orgs.page"}


def test_rbac_enforced_and_ui_gating(client, admin_headers):
    # rôle "lecteur" : uniquement lecture org + page orgs
    role = client.post("/api/roles", headers=admin_headers, json={"nom": uniq("lecteur")}).json()
    client.put(f"/api/roles/{role['id']}/permissions", headers=admin_headers, json=[
        {"feature_code": "api:org.read", "actions": ["view"]},
        {"feature_code": "ui:orgs.page", "actions": ["view"]},
    ])
    email = uniq("lecteur") + "@oscar.fr"
    user = client.post("/api/users", headers=admin_headers,
                       json={"email": email, "nom": "Lecteur", "password": "pass1234",
                             "statut": "active"}).json()
    assert client.post(f"/api/users/{user['id']}/roles", headers=admin_headers,
                       json={"role_id": role["id"]}).status_code == 204

    tok = client.post("/api/auth/login", json={"email": email, "password": "pass1234"}).json()
    h = {"Authorization": f"Bearer {tok['access_token']}"}

    # /me : ne voit que ses 2 features
    me = client.get("/api/auth/me", headers=h).json()
    assert sorted(me["features"]) == ["api:org.read", "ui:orgs.page"]

    # lecture autorisée, écriture interdite
    assert client.get("/api/organisations", headers=h).status_code == 200
    assert client.post("/api/organisations", headers=h,
                       json={"nom": "X", "slug": uniq("x")}).status_code == 403
    # une feature non accordée du tout -> 403
    assert client.get("/api/robots", headers=h).status_code == 403


def test_user_management_profile_password_and_roles(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "User Admin Org", "slug": uniq("user-admin")}).json()
    first_role = client.post("/api/roles", headers=admin_headers,
                             json={"nom": uniq("operator")}).json()
    second_role = client.post("/api/roles", headers=admin_headers,
                              json={"nom": uniq("supervisor")}).json()
    original_email = uniq("managed") + "@oscar.fr"
    managed = client.post("/api/users", headers=admin_headers, json={
        "email": original_email,
        "nom": "Compte à gérer",
        "password": "initial-pass",
        "statut": "active",
        "org_id": org["id"],
    }).json()

    assigned = client.put(f"/api/users/{managed['id']}/roles", headers=admin_headers,
                          json={"role_ids": [first_role["id"], second_role["id"]]})
    assert assigned.status_code == 200, assigned.text
    assert {role["role_id"] for role in assigned.json()["roles"]} == {
        first_role["id"], second_role["id"],
    }

    updated_email = uniq("managed-updated") + "@oscar.fr"
    updated = client.patch(f"/api/users/{managed['id']}", headers=admin_headers, json={
        "nom": "Compte modifié",
        "email": updated_email,
        "password": "replacement-pass",
        "statut": "active",
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()["nom"] == "Compte modifié"
    assert updated.json()["email"] == updated_email
    assert updated.json()["statut"] == "active"

    assert client.post("/api/auth/login", json={
        "email": original_email, "password": "initial-pass",
    }).status_code == 401
    assert client.post("/api/auth/login", json={
        "email": updated_email, "password": "replacement-pass",
    }).status_code == 200

    disabled = client.patch(f"/api/users/{managed['id']}", headers=admin_headers,
                            json={"statut": "disabled"})
    assert disabled.status_code == 200
    assert client.post("/api/auth/login", json={
        "email": updated_email, "password": "replacement-pass",
    }).status_code == 403

    cleared = client.put(f"/api/users/{managed['id']}/roles", headers=admin_headers,
                         json={"role_ids": []})
    assert cleared.status_code == 200
    assert cleared.json()["roles"] == []


# --------------------------------------------------------------------------- #
#  Robots (E) + jetons LiveKit
# --------------------------------------------------------------------------- #
def test_robot_and_livekit_tokens(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "OrgRobot", "slug": uniq("orgrobot")}).json()
    site = client.post("/api/sites", headers=admin_headers,
                       json={"org_id": org["id"], "nom": "Site R", "code": uniq("FR-R")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"], "site_id": site["id"]}).json()
    op = client.post("/api/users", headers=admin_headers,
                     json={"email": uniq("op") + "@oscar.fr", "nom": "Op", "statut": "active"}).json()

    # association
    assert client.post(f"/api/robots/{robot['id']}/assign", headers=admin_headers,
                       json={"user_id": op["id"], "op_role": "pilote"}).status_code == 204

    # émission des 2 jetons
    r = client.post(f"/api/robots/{robot['id']}/tokens", headers=admin_headers,
                    json={"operator_id": op["id"]})
    assert r.status_code == 200, r.text
    pair = r.json()
    room = pair["room"]

    p_robot = jwt.decode(pair["robot"]["token"], livekit_secret(), algorithms=["HS256"])
    assert p_robot["video"]["room"] == room and p_robot["video"]["canPublish"] is True
    p_op = jwt.decode(pair["operator"]["token"], livekit_secret(), algorithms=["HS256"])
    assert p_op["video"]["canPublish"] is False and p_op["video"]["canPublishData"] is True

    toks = client.get(f"/api/robots/{robot['id']}/tokens", headers=admin_headers).json()
    assert len(toks) >= 2
    tid = toks[0]["id"]
    assert client.post(f"/api/tokens/{tid}/revoke", headers=admin_headers).status_code == 204
    revoked = [t for t in client.get(f"/api/robots/{robot['id']}/tokens",
                                     headers=admin_headers).json() if t["id"] == tid][0]
    assert revoked["revoked"] is True


# --------------------------------------------------------------------------- #
#  Sandbox IA (F)
# --------------------------------------------------------------------------- #
def test_ai_model_upload_and_promote(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "Org Vision", "slug": uniq("org-vision")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR-VISION"), "org_id": org["id"]}).json()
    scoped_headers = {**admin_headers, "X-Organization-ID": org["id"]}
    files = {"file": ("model.pt", b"FAKE-TRUSTED-ULTRALYTICS-MODEL", "application/octet-stream")}
    data = {
        "nom": "Retail Detection", "version": uniq("v"), "tache": "product_detection",
        "framework": "ultralytics", "runtime": "ultralytics", "trusted_artifact": "true",
        "labels_json": '["produit", "rayon_vide"]',
    }
    r = client.post("/api/ai/models", headers=scoped_headers, data=data, files=files)
    assert r.status_code == 201, r.text
    model = r.json()
    assert model["statut"] == "sandbox"
    assert model["artifact_sha256"] and model["artifact_size"] > 0
    assert model["labels"] == ["produit", "rayon_vide"]

    r = client.post(f"/api/ai/models/{model['id']}/promote", headers=scoped_headers,
                    json={"statut": "production"})
    assert r.status_code == 200 and r.json()["statut"] == "production"
    assert any(m["id"] == model["id"] for m in client.get("/api/ai/models", headers=scoped_headers).json())

    deployment = client.put(
        f"/api/ai/models/{model['id']}/deployments/{robot['id']}", headers=scoped_headers,
        json={"enabled": True, "inference_fps": 5, "confidence": 30, "iou_threshold": 45},
    )
    assert deployment.status_code == 200, deployment.text
    assert deployment.json()["enabled"] is True

    worker_headers = {"X-OSCAR-Worker-Key": "test-perception-worker-key"}
    manifest = client.get(f"/api/ai/runtime/robots/{robot['id']}/manifest", headers=worker_headers)
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["overlay_topic"] == "oscar.vision.overlay"
    assert manifest.json()["models"][0]["id"] == model["id"]
    session = client.get(f"/api/ai/runtime/robots/{robot['id']}/session", headers=worker_headers)
    assert session.status_code == 200, session.text
    session_payload = session.json()
    decoded = jwt.decode(session_payload["token"], livekit_secret(), algorithms=["HS256"])
    assert session_payload["room"] == manifest.json()["room"]
    assert decoded["video"]["canSubscribe"] is True
    assert decoded["video"]["canPublish"] is False
    assert decoded["video"]["canPublishData"] is True
    artifact = client.get(f"/api/ai/runtime/models/{model['id']}/artifact", headers=worker_headers)
    assert artifact.status_code == 200 and artifact.content == b"FAKE-TRUSTED-ULTRALYTICS-MODEL"


def test_ai_model_rejects_unknown_artifact(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "Org Vision Reject", "slug": uniq("org-vision-reject")}).json()
    scoped_headers = {**admin_headers, "X-Organization-ID": org["id"]}
    response = client.post(
        "/api/ai/models", headers=scoped_headers,
        data={"nom": "Unsafe", "version": "1", "tache": "object_detection"},
        files={"file": ("payload.bin", b"invalid", "application/octet-stream")},
    )
    assert response.status_code == 415


def test_ai_categories(client, admin_headers):
    cats = client.get("/api/ai/categories", headers=admin_headers).json()
    assert len(cats) >= 6  # démo semée
    r = client.post("/api/ai/categories", headers=admin_headers,
                    json={"code": uniq("cat"), "label": "Nouvelle cat", "couleur": "#fff"})
    assert r.status_code == 201
    assert client.delete(f"/api/ai/categories/{r.json()['id']}", headers=admin_headers).status_code == 204


# --------------------------------------------------------------------------- #
#  Audit (transverse)
# --------------------------------------------------------------------------- #
def test_audit_trail(client, admin_headers):
    # une action traçable
    client.post("/api/organisations", headers=admin_headers,
                json={"nom": "AuditOrg", "slug": uniq("auditorg")})
    logs = client.get("/api/audit", headers=admin_headers).json()
    assert len(logs) > 0
    assert any(l["action"] == "ORG_CREATE" for l in logs)


def test_audit_since_filter(client, admin_headers):
    # déclenche une action traçable
    client.post("/api/organisations", headers=admin_headers,
                json={"nom": "SinceOrg", "slug": uniq("sinceorg")})
    # since très ancien -> des entrées ; since dans le futur -> aucune
    past = client.get("/api/audit?since=2000-01-01", headers=admin_headers).json()
    future = client.get("/api/audit?since=2999-01-01", headers=admin_headers).json()
    assert len(past) > 0
    assert future == []


def test_robot_diagnostics(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "DiagOrg", "slug": uniq("diagorg")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    r = client.get(f"/api/robots/{robot['id']}/diagnostics", headers=admin_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["room"].startswith("oscar-")            # room stable
    assert d["reachable"] is False                   # LiveKit injoignable en test
    assert d["clients_count"] == 0
    assert d["health"]["sdk"] == "en_attente"        # SDK pas encore implémenté
    assert d["health"]["livekit"] == "injoignable"


def test_robot_serial_empty_and_duplicate(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "SerOrg", "slug": uniq("serorg")}).json()
    # deux robots sans série -> 201 (série vide traitée comme NULL, pas de doublon)
    r1 = client.post("/api/robots", headers=admin_headers,
                     json={"nom": uniq("R"), "org_id": org["id"], "serial": ""})
    r2 = client.post("/api/robots", headers=admin_headers,
                     json={"nom": uniq("R"), "org_id": org["id"], "serial": ""})
    assert r1.status_code == 201 and r2.status_code == 201
    # même série non vide -> 409 sur le second (au lieu d'un 500)
    s = uniq("SER")
    a = client.post("/api/robots", headers=admin_headers,
                    json={"nom": uniq("R"), "org_id": org["id"], "serial": s})
    b = client.post("/api/robots", headers=admin_headers,
                    json={"nom": uniq("R"), "org_id": org["id"], "serial": s})
    assert a.status_code == 201
    assert b.status_code == 409


def test_robot_integration(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "IntOrg", "slug": uniq("intorg")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    r = client.get(f"/api/robots/{robot['id']}/integration", headers=admin_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["room"].startswith("oscar-")
    assert d["identity"].startswith("robot-")
    assert d["token"]
    assert d["env"]["OSCAR_LIVEKIT_TOKEN"] == d["token"]
    # le jeton SDK doit permettre de publier dans la room du robot
    p = jwt.decode(d["token"], livekit_secret(), algorithms=["HS256"])
    assert p["video"]["canPublish"] is True and p["video"]["room"] == d["room"]


def test_supervise_requires_assignment(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "SupOrg", "slug": uniq("suporg")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()

    # superadmin peut superviser directement
    assert client.post(f"/api/robots/{robot['id']}/supervise", headers=admin_headers).status_code == 200

    # rôle avec api:robot.supervise + un utilisateur
    role = client.post("/api/roles", headers=admin_headers, json={"nom": uniq("sup")}).json()
    client.put(f"/api/roles/{role['id']}/permissions", headers=admin_headers, json=[
        {"feature_code": "api:robot.supervise", "actions": ["execute"]},
        {"feature_code": "api:robot.read", "actions": ["view"]},
    ])
    email = uniq("op") + "@oscar.fr"
    u = client.post("/api/users", headers=admin_headers,
                    json={"email": email, "nom": "Op", "password": "pass1234", "statut": "active"}).json()
    client.post(f"/api/users/{u['id']}/roles", headers=admin_headers, json={"role_id": role["id"]})
    tok = client.post("/api/auth/login", json={"email": email, "password": "pass1234"}).json()
    h = {"Authorization": f"Bearer {tok['access_token']}"}

    # pas associé -> 403 ; après association -> 200
    assert client.post(f"/api/robots/{robot['id']}/supervise", headers=h).status_code == 403
    assert client.post(f"/api/robots/{robot['id']}/assign", headers=admin_headers,
                       json={"user_id": u["id"], "op_role": "pilote"}).status_code == 204
    r = client.post(f"/api/robots/{robot['id']}/supervise", headers=h)
    assert r.status_code == 200
    second_session = client.post(f"/api/robots/{robot['id']}/supervise", headers=h)
    assert second_session.status_code == 200
    assert r.json()["identity"].startswith(f"operator-{u['id']}-")
    assert second_session.json()["identity"].startswith(f"operator-{u['id']}-")
    assert second_session.json()["identity"] != r.json()["identity"]
    # le jeton opérateur ne publie pas mais souscrit
    p = jwt.decode(r.json()["token"], livekit_secret(), algorithms=["HS256"])
    assert p["video"]["canPublish"] is False and p["video"]["canSubscribe"] is True

    # /robots/assigned de cet opérateur contient le robot
    assigned = client.get("/api/robots/assigned", headers=h).json()
    assert any(rr["id"] == robot["id"] for rr in assigned)


def test_integration_operator_and_custom(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "IntOrg2", "slug": uniq("intorg2")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    u = client.post("/api/users", headers=admin_headers,
                    json={"email": uniq("u") + "@oscar.fr", "nom": "Op", "statut": "active"}).json()
    client.post(f"/api/robots/{robot['id']}/assign", headers=admin_headers,
                json={"user_id": u["id"], "op_role": "pilote"})

    # liste des associés
    a = client.get(f"/api/robots/{robot['id']}/assignments", headers=admin_headers).json()
    assert any(x["user_id"] == u["id"] for x in a)

    # intégration opérateur : jeton souscription (pas de publication)
    op = client.get(f"/api/robots/{robot['id']}/integration/operator/{u['id']}", headers=admin_headers)
    assert op.status_code == 200
    d = op.json()
    assert d["kind"] == "operator" and d["identity"] == f"operator-{u['id']}"
    p = jwt.decode(d["token"], livekit_secret(), algorithms=["HS256"])
    assert p["video"]["canPublish"] is False and p["video"]["canSubscribe"] is True

    # intégration "autre" : équipement générique
    r = client.post(f"/api/robots/{robot['id']}/integration/custom", headers=admin_headers,
                    json={"name": "Capteur Lidar", "can_publish": True})
    assert r.status_code == 200
    c = r.json()
    assert c["kind"] == "custom" and c["identity"].startswith("client-")
    assert c["room"].startswith("oscar-")
    pc = jwt.decode(c["token"], livekit_secret(), algorithms=["HS256"])
    assert pc["video"]["canPublish"] is True
    # nom requis
    assert client.post(f"/api/robots/{robot['id']}/integration/custom", headers=admin_headers,
                       json={"name": ""}).status_code == 400


def test_robot_unassign(client, admin_headers):
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": "UnaOrg", "slug": uniq("unaorg")}).json()
    robot = client.post("/api/robots", headers=admin_headers,
                        json={"nom": uniq("OSCAR"), "org_id": org["id"]}).json()
    u = client.post("/api/users", headers=admin_headers,
                    json={"email": uniq("u") + "@oscar.fr", "nom": "Op", "statut": "active"}).json()
    client.post(f"/api/robots/{robot['id']}/assign", headers=admin_headers,
                json={"user_id": u["id"], "op_role": "pilote"})
    assert any(x["user_id"] == u["id"] for x in
               client.get(f"/api/robots/{robot['id']}/assignments", headers=admin_headers).json())
    # dissocier
    assert client.delete(f"/api/robots/{robot['id']}/assignments/{u['id']}", headers=admin_headers).status_code == 204
    assert not any(x["user_id"] == u["id"] for x in
                   client.get(f"/api/robots/{robot['id']}/assignments", headers=admin_headers).json())
    # re-dissocier -> 404
    assert client.delete(f"/api/robots/{robot['id']}/assignments/{u['id']}", headers=admin_headers).status_code == 404
