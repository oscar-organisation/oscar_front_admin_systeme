"""La commande d'enrolement doit tenir en un seul collage.

L'enrolement demandait huit gestes sur le robot, dont deux ou l'on se trompe :
recopier une cle de 48 caracteres, et remplir un fichier d'environnement a la
main. La console assemble desormais la commande complete.
"""

import re

from app.routers.robots import _commande_cle, _commande_enrolement, _famille_suggeree


class _Robot:
    def __init__(self, slug="oscar-04", modele=None, modele_constate=None):
        self.slug = slug
        self.modele = modele
        self.modele_constate = modele_constate


class _Requete:
    base_url = "https://api-admin.oscar-bot.com/"


CLE = "2488" + "a" * 44


def test_la_famille_declaree_par_le_robot_prime():
    robot = _Robot(modele="ROSMASTER M3 Pro", modele_constate="rosmaster-m3pro")
    assert _famille_suggeree(robot) == "rosmaster-m3pro"


def test_sans_declaration_l_etiquette_sert_de_suggestion():
    """Et elle peut etre fausse : « ROSMASTER M3 Pro » donne « rosmaster-m3-pro »
    quand le profil s'appelle « rosmaster-m3pro ». C'est assume — le script
    d'enrolement confronte la suggestion aux profils reellement presents et
    echoue en listant les familles disponibles."""
    assert _famille_suggeree(_Robot(modele="ROSMASTER M3 Pro")) == "rosmaster-m3-pro"
    assert _famille_suggeree(_Robot(modele="Unitree G1")) == "unitree-g1"


def test_sans_rien_la_commande_le_dit_au_lieu_de_deviner():
    assert _famille_suggeree(_Robot()) == "FAMILLE-A-RENSEIGNER"


def test_la_commande_porte_la_cle_une_seule_fois():
    """Deux occurrences la feraient apparaitre dans `ps` pendant la requete."""
    commande = _commande_enrolement(_Requete(), _Robot(), CLE)
    assert commande.count(CLE) == 1


def test_rien_n_est_telecharge_sans_authentification():
    """Pas de chemin public, et pas de code execute sans preuve de provenance."""
    commande = _commande_enrolement(_Requete(), _Robot(), CLE)
    appels = re.findall(r"^curl .*", commande, re.MULTILINE)
    assert appels, "la commande doit telecharger l'archive"
    for appel in appels:
        assert "--config" in appel, "l'en-tete doit passer par un fichier, pas par -H"
    assert "/studio/runtime/robots/" in commande


def test_la_commande_delegue_au_script_du_paquet():
    """Le preambule ne fait que ce qui doit arriver avant que l'archive existe."""
    commande = _commande_enrolement(_Requete(), _Robot(slug="oscar-07"), CLE)
    assert "scripts/enroll-local.sh" in commande
    assert "--robot oscar-07" in commande
    assert commande.count("\n") < 15, "le preambule doit rester lisible d'un coup d'oeil"


def test_les_permissions_sont_posees_avant_l_ecriture():
    commande = _commande_enrolement(_Requete(), _Robot(), CLE)
    assert "umask 077" in commande
    assert "install -d -m 0700 /etc/oscar/credentials" in commande
    assert commande.index("umask") < commande.index("agent.key")


def test_la_commande_de_cle_seule_reste_disponible():
    """Un robot deja en service dont on revoque la cle n'a pas besoin du reste."""
    commande = _commande_cle(CLE)
    assert "agent.key" in commande and CLE in commande
    assert "enroll-local" not in commande
