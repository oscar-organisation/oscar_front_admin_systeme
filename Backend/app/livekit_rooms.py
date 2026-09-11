import re

from .models import Robot


def room_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-") or "x"


def robot_room(robot: Robot) -> str:
    """Return the stable, canonical LiveKit room assigned to a robot."""
    return f"oscar-{room_slug(robot.nom)}-{robot.id[:8]}"
