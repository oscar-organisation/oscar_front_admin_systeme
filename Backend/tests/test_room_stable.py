"""La salle LiveKit d'un robot ne doit pas dépendre de son nom d'affichage.

Elle en dépendait. Renommer « OSCAR-02 » en « ROSMASTER M3 Pro Hetic » a
déplacé la salle calculée par la console, tandis que les identifiants du robot,
émis une fois pour toutes, continuaient de viser l'ancienne. Le robot publiait
à 22 images par seconde dans une salle que plus personne n'écoutait, et la
supervision restait noire sans qu'aucune erreur ne soit levée nulle part.
"""

from app.livekit_rooms import robot_room


class _Robot:
    def __init__(self, nom, slug, identifiant="d97da823be9b400f9e8ec468bd876f08"):
        self.nom = nom
        self.slug = slug
        self.id = identifiant


def test_renommer_un_robot_ne_deplace_pas_sa_salle():
    avant = robot_room(_Robot("OSCAR-02", "oscar-02"))
    apres = robot_room(_Robot("ROSMASTER M3 Pro Hetic", "oscar-02"))
    assert avant == apres


def test_la_salle_porte_le_slug_et_non_le_libelle():
    assert robot_room(_Robot("Nom quelconque", "oscar-02")) == "oscar-oscar-02-d97da823"


def test_deux_robots_de_meme_nom_ont_des_salles_distinctes():
    """Le suffixe d'identifiant reste nécessaire : deux sites peuvent nommer
    leur robot pareil."""
    a = robot_room(_Robot("Robot", "robot-a", "aaaaaaaa" + "0" * 24))
    b = robot_room(_Robot("Robot", "robot-b", "bbbbbbbb" + "0" * 24))
    assert a != b


def test_un_robot_sans_slug_retombe_sur_son_nom():
    """Aucun robot n'existe sans slug aujourd'hui, mais un repli vaut mieux
    qu'une salle nommée « oscar-None »."""
    assert robot_room(_Robot("OSCAR-02", None)) == "oscar-oscar-02-d97da823"
