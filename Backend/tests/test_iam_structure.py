import uuid


def unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def create_org(client, headers, name: str):
    response = client.post(
        "/api/organisations",
        headers=headers,
        json={"nom": name, "slug": unique(name.lower())},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_organisation_categories_hierarchy_and_cycle_guard(client, admin_headers):
    category = client.post(
        "/api/organisation-categories",
        headers=admin_headers,
        json={"code": unique("operational"), "nom": "Site opérationnel"},
    )
    assert category.status_code == 201, category.text
    root = create_org(client, admin_headers, "Racine IAM")
    child = create_org(client, admin_headers, "Filiale IAM")

    root_update = client.patch(
        f"/api/organisations/{root['id']}",
        headers=admin_headers,
        json={
            "nom": root["nom"], "slug": root["slug"],
            "category_id": category.json()["id"],
        },
    )
    assert root_update.status_code == 200, root_update.text
    child_update = client.patch(
        f"/api/organisations/{child['id']}",
        headers=admin_headers,
        json={"nom": child["nom"], "slug": child["slug"], "parent_id": root["id"]},
    )
    assert child_update.status_code == 200, child_update.text

    tree = client.get("/api/organisations/tree", headers=admin_headers).json()
    indexed = {item["id"]: item for item in tree}
    assert indexed[root["id"]]["category_nom"] == "Site opérationnel"
    assert indexed[child["id"]]["parent_id"] == root["id"]
    assert indexed[child["id"]]["depth"] == indexed[root["id"]]["depth"] + 1

    cycle = client.patch(
        f"/api/organisations/{root['id']}",
        headers=admin_headers,
        json={"nom": root["nom"], "slug": root["slug"], "parent_id": child["id"]},
    )
    assert cycle.status_code == 400


def test_team_role_group_permissions_and_multi_org_membership(client, admin_headers):
    org_a = create_org(client, admin_headers, "Organisation A")
    org_b = create_org(client, admin_headers, "Organisation B")
    email = unique("team-user") + "@oscar.fr"
    user = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "email": email, "nom": "Membre équipe", "password": "pass-iam-123",
            "statut": "active", "org_id": org_a["id"],
        },
    ).json()
    memberships = client.put(
        f"/api/users/{user['id']}/organisations",
        headers=admin_headers,
        json={"org_ids": [org_a["id"], org_b["id"]], "primary_org_id": org_a["id"]},
    )
    assert memberships.status_code == 200, memberships.text
    assert set(memberships.json()["organisation_ids"]) == {org_a["id"], org_b["id"]}

    permission_group = client.post(
        "/api/permission-groups",
        headers=admin_headers,
        json={
            "nom": unique("Lecture organisations"),
            "visibility": "public",
            "permissions": [
                {"feature_code": "api:org.read", "actions": ["view"]},
                {"feature_code": "ui:orgs.page", "actions": ["view"]},
            ],
        },
    )
    assert permission_group.status_code == 201, permission_group.text
    role_group = client.post(
        "/api/role-groups",
        headers=admin_headers,
        json={
            "nom": unique("Lecteurs terrain"),
            "visibility": "public",
            "permission_group_ids": [permission_group.json()["id"]],
        },
    )
    assert role_group.status_code == 201, role_group.text

    team = client.post(
        "/api/teams",
        headers=admin_headers,
        json={"nom": unique("Equipe terrain"), "org_ids": [org_a["id"], org_b["id"]]},
    )
    assert team.status_code == 201, team.text
    team_id = team.json()["id"]
    assert client.put(
        f"/api/teams/{team_id}/members",
        headers=admin_headers,
        json={"user_ids": [user["id"]]},
    ).status_code == 200
    assert client.put(
        f"/api/teams/{team_id}/access",
        headers=admin_headers,
        json={"role_group_ids": [role_group.json()["id"]]},
    ).status_code == 200

    token = client.post(
        "/api/auth/login", json={"email": email, "password": "pass-iam-123"}
    ).json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert set(me.json()["features"]) == {"api:org.read", "ui:orgs.page"}


def test_auth_context_exposes_roles_and_permissions_per_organisation(client, admin_headers):
    org_a = create_org(client, admin_headers, "Contexte Nord")
    org_b = create_org(client, admin_headers, "Contexte Sud")
    role = client.post(
        "/api/roles",
        headers=admin_headers,
        json={
            "nom": unique("Superviseur Nord"),
            "org_id": org_a["id"],
            "visibility": "private",
        },
    ).json()
    permissions = client.put(
        f"/api/roles/{role['id']}/permissions",
        headers=admin_headers,
        json=[
            {"feature_code": "api:robot.read", "actions": ["view"]},
            {"feature_code": "ui:robots.page", "actions": ["view"]},
        ],
    )
    assert permissions.status_code == 200, permissions.text

    email = unique("scoped-user") + "@oscar.fr"
    user = client.post(
        "/api/users",
        headers=admin_headers,
        json={
            "email": email,
            "nom": "Opérateur multi-organisation",
            "password": "pass-context-123",
            "statut": "active",
            "org_id": org_a["id"],
        },
    ).json()
    memberships = client.put(
        f"/api/users/{user['id']}/organisations",
        headers=admin_headers,
        json={"org_ids": [org_a["id"], org_b["id"]], "primary_org_id": org_a["id"]},
    )
    assert memberships.status_code == 200, memberships.text
    assignment = client.post(
        f"/api/users/{user['id']}/roles",
        headers=admin_headers,
        json={"role_id": role["id"], "scope_type": "org", "scope_id": org_a["id"]},
    )
    assert assignment.status_code == 204, assignment.text

    token = client.post(
        "/api/auth/login", json={"email": email, "password": "pass-context-123"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    north = client.get(
        "/api/auth/me", headers={**headers, "X-Organization-ID": org_a["id"]}
    ).json()
    south = client.get(
        "/api/auth/me", headers={**headers, "X-Organization-ID": org_b["id"]}
    ).json()

    north_context = next(org for org in north["organisations"] if org["id"] == org_a["id"])
    south_context = next(org for org in south["organisations"] if org["id"] == org_b["id"])
    assert role["nom"] in north_context["roles"]
    assert north_context["permissions"]["api:robot.read"] == ["view"]
    assert south_context["roles"] == []
    assert south_context["permissions"] == {}
    assert "api:robot.read" in north["permissions"]
    assert south["permissions"] == {}


def test_fleet_robot_assignment(client, admin_headers):
    org = create_org(client, admin_headers, "Organisation flotte")
    robot = client.post(
        "/api/robots",
        headers=admin_headers,
        json={"nom": unique("OSCAR"), "org_id": org["id"]},
    ).json()
    fleet = client.post(
        "/api/fleets",
        headers=admin_headers,
        json={
            "nom": "Flotte principale", "code": unique("FLEET"),
            "org_id": org["id"], "robot_ids": [robot["id"]],
        },
    )
    assert fleet.status_code == 201, fleet.text
    assert fleet.json()["robot_ids"] == [robot["id"]]
