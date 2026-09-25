"""Présence d'un robot, constatée plutôt que déclarée.

La colonne `robots.statut` était posée à la création du robot et plus jamais
écrite : un robot éteint depuis trois jours restait « online » dans la console
2D comme dans le cockpit XR. La pastille ne disait donc rien, et personne ne
pouvait s'y fier pour savoir si une téléopération avait une chance d'aboutir.

On garde la colonne pour ce qu'elle sait vraiment dire, la mise en maintenance,
qui est une décision humaine. Le reste se déduit du dernier contact de l'agent
embarqué, quelle que soit la route qu'il a empruntée.
"""

from datetime import datetime, timedelta, timezone

# L'agent interroge son bundle toutes les 45 secondes (oscar-edge-sync.timer).
# Trois minutes laissent passer quatre relèves manquées : de quoi absorber une
# coupure réseau brève sans annoncer un robot vivant alors qu'il est éteint.
SILENCE_TOLERE = timedelta(minutes=3)


def presence(statut: str | None, vu_le: datetime | None,
             maintenant: datetime | None = None) -> str:
    """« online », « offline » ou « maintenance » pour ce robot.

    La maintenance l'emporte : c'est un état voulu, pas une observation.
    """
    if statut == "maintenance":
        return "maintenance"
    if vu_le is None:
        return "offline"
    reference = maintenant or datetime.now(timezone.utc)
    # SQLite rend des horodatages naïfs là où PostgreSQL les rend datés.
    date_vue = vu_le if vu_le.tzinfo else vu_le.replace(tzinfo=timezone.utc)
    return "online" if reference - date_vue <= SILENCE_TOLERE else "offline"
