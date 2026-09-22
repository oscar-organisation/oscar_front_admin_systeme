"""Catalogue de compositions de référence maintenu par la plateforme.

Un préset n'appartient à aucune organisation : c'est ce qui le sépare d'un
bundle, et c'est aussi ce qui impose ses garde-fous. Ce que ces tests
verrouillent, c'est la portée — qui peut verser au catalogue, et ce qu'un
client y voit.
"""

import uuid

import pytest

from test_studio_bundles import _publier, contexte, spec, uniq  # noqa: F401


def preset(**surcharges) -> dict:
    corps = {
        "slug": uniq("rosmaster-m3pro"),
        "nom": "ROSMASTER M3 Pro — magasin",
        "famille": "rosmaster-m3pro",
        "constructeur": "Yahboom",
        "description": "Composition éprouvée en magasin.",
        "spec": spec(),
    }
    corps.update(surcharges)
    return corps


@pytest.fixture()
def client_simple(client, admin_headers):
    """Un compte qui administre son organisation sans être super administrateur."""
    org = client.post("/api/organisations", headers=admin_headers,
                      json={"nom": uniq("Client"), "slug": uniq("client")}).json()
    entetes_org = {**admin_headers, "X-Organization-ID": org["id"]}
    email = f"{uuid.uuid4().hex[:8]}@exemple.fr"
    client.post("/api/users", headers=entetes_org,
                json={"email": email, "nom": "Chef de projet", "password": "motdepasse-solide",
                      "org_id": org["id"], "roles": ["Administrateur"]})
    jeton = client.post("/api/auth/login",
                        json={"email": email, "password": "motdepasse-solide"})
    if jeton.status_code != 200:
        pytest.skip("compte client non connectable dans ce jeu de donnees")
    return {"Authorization": f"Bearer {jeton.json()['access_token']}",
            "X-Organization-ID": org["id"]}


class TestPortee:
    def test_un_administrateur_client_ne_verse_pas_au_catalogue(self, client, client_simple):
        """Le catalogue est vu par toutes les organisations : une seule l'écrit."""
        r = client.post("/api/studio/presets", headers=client_simple, json=preset())
        assert r.status_code == 403, r.text

    def test_le_super_administrateur_verse_au_catalogue(self, client, admin_headers):
        r = client.post("/api/studio/presets", headers=admin_headers, json=preset())
        assert r.status_code == 201, r.text
        assert r.json()["statut"] == "draft"
        assert r.json()["revision"] == 1


class TestVisibilite:
    def test_un_brouillon_ne_remonte_pas_dans_le_catalogue(self, client, admin_headers):
        cree = client.post("/api/studio/presets", headers=admin_headers,
                           json=preset()).json()
        publies = client.get("/api/studio/presets", headers=admin_headers).json()
        assert cree["slug"] not in [p["slug"] for p in publies]

    def test_un_preset_publie_remonte(self, client, admin_headers):
        cree = client.post("/api/studio/presets", headers=admin_headers,
                           json=preset()).json()
        client.patch(f"/api/studio/presets/{cree['id']}", headers=admin_headers,
                     json={"statut": "published"})
        publies = client.get("/api/studio/presets", headers=admin_headers).json()
        assert cree["slug"] in [p["slug"] for p in publies]

    def test_le_catalogue_se_filtre_par_famille_de_chassis(self, client, admin_headers):
        for famille in ("rosmaster-m3pro", "unitree-g1"):
            cree = client.post("/api/studio/presets", headers=admin_headers,
                               json=preset(famille=famille)).json()
            client.patch(f"/api/studio/presets/{cree['id']}", headers=admin_headers,
                         json={"statut": "published"})
        r = client.get("/api/studio/presets?famille=unitree-g1", headers=admin_headers).json()
        assert r and {p["famille"] for p in r} == {"unitree-g1"}


class TestEnrichissement:
    def test_une_version_publiee_devient_un_preset_avec_sa_composition(
            self, client, admin_headers, contexte):
        """La bibliothèque s'enrichit de ce qui a fait ses preuves sur un robot."""
        version = _publier(client, contexte)
        r = client.post(f"/api/studio/presets/from-version/{version['id']}",
                        headers=admin_headers, json=preset())
        assert r.status_code == 201, r.text
        assert r.json()["spec"]["nodes"], "la composition doit voyager avec le preset"

    def test_une_version_en_brouillon_ne_devient_pas_un_preset(
            self, client, admin_headers, contexte):
        """Un point de départ proposé à tous doit d'abord avoir été figé."""
        bundle_id = contexte["bundle"]["id"]
        brouillon = client.put(f"/api/studio/bundles/{bundle_id}/draft",
                               headers=contexte["entetes"], json={"spec": spec()}).json()
        r = client.post(f"/api/studio/presets/from-version/{brouillon['id']}",
                        headers=admin_headers, json=preset())
        assert r.status_code == 409, r.text


class TestIntegrite:
    def test_deux_presets_ne_partagent_pas_un_slug(self, client, admin_headers):
        corps = preset()
        assert client.post("/api/studio/presets", headers=admin_headers,
                           json=corps).status_code == 201
        assert client.post("/api/studio/presets", headers=admin_headers,
                           json=corps).status_code == 409

    def test_un_slug_mal_forme_est_refuse(self, client, admin_headers):
        r = client.post("/api/studio/presets", headers=admin_headers,
                        json=preset(slug="ROSMASTER M3 Pro"))
        assert r.status_code == 400, r.text

    def test_corriger_la_composition_fait_avancer_la_revision(self, client, admin_headers):
        """Un préset corrigé reste le même préset."""
        cree = client.post("/api/studio/presets", headers=admin_headers,
                           json=preset()).json()
        r = client.patch(f"/api/studio/presets/{cree['id']}", headers=admin_headers,
                         json={"spec": spec("CANAL_EMISSION_TELEMETRIE")}).json()
        assert r["revision"] == 2
        assert r["slug"] == cree["slug"]

    def test_renommer_ne_fait_pas_avancer_la_revision(self, client, admin_headers):
        """La révision suit le fond, pas l'étiquette."""
        cree = client.post("/api/studio/presets", headers=admin_headers,
                           json=preset()).json()
        r = client.patch(f"/api/studio/presets/{cree['id']}", headers=admin_headers,
                         json={"nom": "ROSMASTER M3 Pro — entrepôt"}).json()
        assert r["revision"] == 1
