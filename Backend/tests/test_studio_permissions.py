"""Capacites du Studio de deploiement dans le catalogue RBAC.

Le Studio compose des bundles (agents, canaux, cible materielle) puis les
deploie sur du materiel reel. Publier et deployer sont donc separes de la
simple composition : ces tests verrouillent ce decoupage.
"""

STUDIO_ATTENDU = {
    "api:bundle.read": ["view"],
    "api:bundle.write": ["view", "create", "update", "delete"],
    "api:bundle.publish": ["view", "execute"],
    "api:deployment.read": ["view"],
    "api:deployment.execute": ["view", "execute"],
    "ui:studio.page": ["view"],
    "ui:studio.publish_button": ["view"],
}


def _features(client, admin_headers):
    r = client.get("/api/features", headers=admin_headers)
    assert r.status_code == 200, r.text
    return {f["code"]: f for f in r.json()}


def test_catalogue_expose_les_capacites_studio(client, admin_headers):
    features = _features(client, admin_headers)
    for code, actions in STUDIO_ATTENDU.items():
        assert code in features, f"{code} absent du catalogue"
        assert features[code]["module"] == "studio"
        assert features[code]["actions"] == actions
        assert features[code]["type"] == code.split(":", 1)[0]


def _role(client, admin_headers, nom):
    roles = client.get("/api/roles", headers=admin_headers).json()
    cible = next((r for r in roles if r["nom"] == nom), None)
    assert cible, f"role {nom} absent"
    detail = client.get(f"/api/roles/{cible['id']}", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    return {p["feature_code"] for p in detail.json()["permissions"]}


def test_gestionnaire_de_flotte_peut_deployer(client, admin_headers):
    codes = _role(client, admin_headers, "Gestionnaire de flotte")
    assert STUDIO_ATTENDU.keys() <= codes


def test_operateur_2d_ne_peut_pas_deployer(client, admin_headers):
    codes = _role(client, admin_headers, "Opérateur 2D")
    assert not (STUDIO_ATTENDU.keys() & codes)
