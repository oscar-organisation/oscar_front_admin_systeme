"""Introspection LiveKit via l'API serveur RoomService (Twirp/JSON).

Ne dépend d'aucun paquet externe (urllib stdlib) et ne lève jamais : renvoie
(reachable, participants). Si le serveur LiveKit est injoignable, on renvoie
(False, []) pour que le diagnostic s'affiche quand même côté console.
"""
import json
import urllib.request

from .config import settings
from .security import create_livekit_server_token


def list_participants(room: str, timeout: float = 3.0) -> tuple[bool, list[dict]]:
    url = settings.livekit_host_url.rstrip("/") + "/twirp/livekit.RoomService/ListParticipants"
    token = create_livekit_server_token(room)
    body = json.dumps({"room": room}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode() or "{}")
            return True, list(data.get("participants") or [])
    except Exception:
        return False, []
