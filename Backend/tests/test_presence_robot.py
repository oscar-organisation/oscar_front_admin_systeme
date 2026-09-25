"""La pastille de présence doit refléter le robot, pas la saisie initiale.

`robots.statut` était écrit à la création puis plus jamais. Toute la flotte
s'affichait « online » en permanence, dans la console 2D comme dans le cockpit
XR : le 24 septembre, le ROSMASTER était hors tension depuis dix minutes et la
console le donnait toujours en ligne.
"""

from datetime import datetime, timedelta, timezone

from app.presence import SILENCE_TOLERE, presence
from app.schemas import RobotOut


MAINTENANT = datetime(2026, 9, 25, 12, 0, tzinfo=timezone.utc)


def test_un_robot_vu_a_l_instant_est_en_ligne():
    assert presence("offline", MAINTENANT - timedelta(seconds=20), MAINTENANT) == "online"


def test_un_robot_silencieux_passe_hors_ligne():
    vieux = MAINTENANT - SILENCE_TOLERE - timedelta(seconds=1)
    assert presence("online", vieux, MAINTENANT) == "offline"


def test_quatre_releves_manquees_restent_tolerees():
    """L'agent interroge son bundle toutes les 45 secondes. Une coupure réseau
    brève ne doit pas faire clignoter la flotte."""
    assert presence("offline", MAINTENANT - timedelta(seconds=150), MAINTENANT) == "online"


def test_un_robot_jamais_vu_est_hors_ligne():
    assert presence("online", None, MAINTENANT) == "offline"


def test_la_maintenance_est_une_decision_et_non_une_observation():
    assert presence("maintenance", None, MAINTENANT) == "maintenance"
    assert presence("maintenance", MAINTENANT, MAINTENANT) == "maintenance"


def test_un_horodatage_naif_est_lu_en_utc():
    """SQLite rend des dates sans fuseau là où PostgreSQL les rend datées."""
    naif = (MAINTENANT - timedelta(seconds=10)).replace(tzinfo=None)
    assert presence("offline", naif, MAINTENANT) == "online"


def test_la_reponse_de_l_api_corrige_le_statut_declare():
    """Le correctif tient dans la sérialisation : les deux clients lisent ce
    champ sans savoir qu'il est calculé."""
    robot = RobotOut(id="a" * 32, nom="ROSMASTER", statut="online", vu_le=None)
    assert robot.statut == "offline"

    vivant = RobotOut(id="b" * 32, nom="ROSMASTER", statut="offline",
                      vu_le=datetime.now(timezone.utc))
    assert vivant.statut == "online"
