import re

from .models import Robot


def room_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-") or "x"


def robot_room(robot: Robot) -> str:
    """Salle LiveKit d'un robot, insensible a son renommage.

    Elle etait derivee de `nom`, le libelle d'affichage. Renommer un robot
    changeait donc sa salle, alors que ses identifiants LiveKit, emis une fois,
    continuaient de viser l'ancienne : le robot publiait dans une salle que la
    console n'ecoutait plus, et la supervision restait noire sans qu'aucune
    erreur ne soit levee de part et d'autre.

    Le slug est l'identifiant terrain, pose a la creation et jamais modifie par
    un renommage — c'est la garantie que porte deja le modele. On s'y accroche.
    """
    return f"oscar-{room_slug(robot.slug or robot.nom)}-{robot.id[:8]}"
