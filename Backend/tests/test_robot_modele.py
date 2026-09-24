"""Famille de châssis d'un robot : saisie par l'opérateur, constatée par le robot.

La plateforme savait nommer un robot sans pouvoir dire de quel matériel il
s'agissait. Trois propriétés rendent le champ utile, et ces tests les tiennent :

- la normalisation rattrape la casse et les espaces, mais **ne devine pas** où
  un constructeur a collé deux mots ; c'est pourquoi la liste des familles
  connues existe, et c'est elle le vrai garde-fou ;
- ce que l'opérateur saisit et ce que le robot déclare sont deux champs
  distincts, et leur écart est une information qu'on montre ;
- un agent d'une version antérieure, qui ne déclare rien, n'efface pas ce
  qu'on savait déjà.
"""

from test_edge_releases import contexte, uniq  # noqa: F401


class TestSaisie:
    def test_la_casse_et_les_espaces_ne_creent_pas_deux_familles(self, client, contexte):
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("OSCAR"), "org_id": contexte["org"]["id"],
                              "modele": "  ROSMASTER-M3PRO  "})
        assert r.status_code == 201, r.text
        assert r.json()["modele"] == "rosmaster-m3pro"

    def test_la_normalisation_ne_devine_pas_les_mots_colles(self, client, contexte):
        """Limite assumée : « M3 Pro » ne peut pas devenir « m3pro ».

        Le constructeur a collé deux mots, rien dans le texte ne le dit. C'est
        la liste des familles connues qui évite l'erreur, pas le slugifieur, et
        la déclaration du robot qui la révèle si elle passe quand même.
        """
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("OSCAR"), "org_id": contexte["org"]["id"],
                              "modele": "ROSMASTER M3 Pro"})
        assert r.json()["modele"] == "rosmaster-m3-pro"

    def test_une_famille_inconnue_est_acceptee_sans_migration(self, client, contexte):
        """Un châssis d'un autre constructeur doit pouvoir entrer tout de suite."""
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("G1"), "org_id": contexte["org"]["id"],
                              "modele": "Unitree G1"})
        assert r.status_code == 201, r.text
        assert r.json()["modele"] == "unitree-g1"

    def test_un_robot_sans_famille_reste_valide(self, client, contexte):
        """Le champ est une information, pas une condition d'existence."""
        r = client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq("Sans modele"), "org_id": contexte["org"]["id"]})
        assert r.status_code == 201, r.text
        assert r.json()["modele"] is None


class TestFamillesConnues:
    def test_les_familles_deja_portees_sont_proposees(self, client, contexte):
        client.post("/api/robots", headers=contexte["entetes"],
                    json={"nom": uniq("G1"), "org_id": contexte["org"]["id"],
                          "modele": "unitree-g1"})
        familles = client.get("/api/robots/modeles", headers=contexte["entetes"]).json()
        assert "unitree-g1" in familles

    def test_la_liste_est_triee_et_sans_doublon(self, client, contexte):
        for nom in ("A", "B"):
            client.post("/api/robots", headers=contexte["entetes"],
                        json={"nom": uniq(nom), "org_id": contexte["org"]["id"],
                              "modele": "unitree-g1"})
        familles = client.get("/api/robots/modeles", headers=contexte["entetes"]).json()
        assert familles == sorted(set(familles))


class TestDeclaration:
    def test_le_robot_declare_le_chassis_sur_lequel_il_tourne(self, client, contexte):
        r = client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"})
        assert r.status_code == 200, r.text

        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele_constate"] == "rosmaster-m3pro"

    def test_la_declaration_n_ecrase_pas_la_saisie(self, client, contexte):
        """L'écart entre les deux est l'information, pas une erreur à masquer.

        C'est ce cas qui rattrape la limite du slugifieur : une famille mal
        orthographiée à la saisie se voit dès que le robot déclare la sienne.
        """
        client.patch(f"/api/robots/{contexte['robot']['id']}", headers=contexte["entetes"],
                   json={"nom": contexte["robot"]["nom"], "modele": "ROSMASTER M3 Pro"})
        client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"})

        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele"] == "rosmaster-m3-pro"
        assert detail["modele_constate"] == "rosmaster-m3pro"
        assert detail["modele"] != detail["modele_constate"], "l'ecart doit rester visible"

    def test_un_compte_rendu_sans_profil_ne_change_rien(self, client, contexte):
        """Un agent d'une version antérieure ne doit pas effacer ce qu'on sait."""
        client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.0", "statut": "installed", "profil": "rosmaster-m3pro"})
        client.post(
            f"/api/studio/runtime/robots/{contexte['robot']['slug']}/release/report",
            headers=contexte["cle"],
            json={"version": "1.0.1", "statut": "installed"})

        detail = client.get(f"/api/robots/{contexte['robot']['id']}",
                            headers=contexte["entetes"]).json()
        assert detail["modele_constate"] == "rosmaster-m3pro"
