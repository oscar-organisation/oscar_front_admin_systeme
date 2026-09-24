"""Modèle de châssis d'un robot : une étiquette humaine, une clé technique.

Le champ a d'abord porté les deux rôles à la fois, et c'était le défaut : une
étiquette lisible et une clé qui doit correspondre au profil embarqué n'ont pas
les mêmes contraintes. Normaliser « ROSMASTER M3 Pro » produisait
`rosmaster-m3-pro` là où le constructeur écrit `rosmaster-m3pro` — faux, avec
l'apparence d'une correction.

Les deux rôles sont désormais séparés, et ces tests le verrouillent : ce que
l'opérateur tape est conservé tel quel, et la clé technique vient du robot.
"""

from test_edge_releases import contexte, uniq  # noqa: F401


class TestEtiquette:
    def test_la_saisie_est_conservee_telle_quelle(self, client, contexte):
        """Aucune transformation : deviner produirait une erreur silencieuse."""
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("OSCAR"), "org_id": contexte["org"]["id"],
                              "modele": "ROSMASTER M3 Pro"})
        assert r.status_code == 201, r.text
        assert r.json()["modele"] == "ROSMASTER M3 Pro"

    def test_un_chassis_inconnu_s_ajoute_en_le_tapant(self, client, contexte):
        """Personne ne connaît tous les châssis qui existeront."""
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("Proto"), "org_id": contexte["org"]["id"],
                              "modele": "prototype interne v3"})
        assert r.json()["modele"] == "prototype interne v3"

    def test_un_robot_sans_modele_reste_valide(self, client, contexte):
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("Sans modele"), "org_id": contexte["org"]["id"]})
        assert r.status_code == 201, r.text
        assert r.json()["modele"] is None

    def test_les_modeles_deja_saisis_sont_proposes(self, client, contexte):
        """Commodité de saisie, pas contrainte : deux opérateurs écrivent pareil."""
        client.post("/api/robots", headers=contexte["entetes"],
                    json={"nom": uniq("G1"), "org_id": contexte["org"]["id"],
                          "modele": "Unitree G1"})
        propositions = client.get("/api/robots/modeles", headers=contexte["entetes"]).json()
        assert "Unitree G1" in propositions
        assert propositions == sorted(set(propositions))


class TestCleTechnique:
    def test_le_robot_declare_la_famille_de_son_profil(self, client, contexte):
        r = client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"})
        assert r.status_code == 200, r.text
        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele_constate"] == "rosmaster-m3pro"

    def test_l_etiquette_et_la_cle_cohabitent_sans_se_contredire(self, client, contexte):
        """Deux espaces de noms distincts : l'un se lit, l'autre s'accroche."""
        client.patch(f"/api/robots/{contexte['robot']['id']}", headers=contexte["entetes"],
                     json={"nom": contexte["robot"]["nom"], "modele": "ROSMASTER M3 Pro"})
        client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"})
        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele"] == "ROSMASTER M3 Pro"
        assert detail["modele_constate"] == "rosmaster-m3pro"

    def test_un_compte_rendu_sans_profil_n_efface_rien(self, client, contexte):
        """Un agent d'une version antérieure ne doit pas perdre ce qu'on sait."""
        for corps in ({"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"},
                      {"version": "1.0.1", "statut": "installed"}):
            client.post(
                f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
                headers=contexte["cle"], json=corps)
        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele_constate"] == "rosmaster-m3pro"
