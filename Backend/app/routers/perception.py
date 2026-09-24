"""Répartition de la flotte entre les workers de perception.

Un worker servait un seul robot, figé dans sa configuration, et le déploiement
suivait : un conteneur par robot, chacun rechargeant les mêmes modèles en
mémoire. À cent robots ce modèle est impossible.

Ce module donne aux workers un endroit où se répartir le travail. Un worker
annonce sa capacité, le serveur lui confie des robots pour une durée limitée,
et ce bail sert aussi de preuve de vie : un worker qui ne renouvelle plus perd
ses robots, qu'un autre reprend.

Cette seconde propriété n'est pas un bonus. Le 23 septembre 2026, deux workers
se sont arrêtés à vingt-sept secondes d'intervalle et la couche de vision est
restée hors service dix-huit heures sans que rien ne le signale. Le registre
des baux rend cette situation visible : un robot qui mérite la perception et
n'a pas de bail vivant apparaît comme découvert.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require
from ..models import PerceptionLease, Robot
from ..schemas import PerceptionCoverageOut, PerceptionLeaseIn, PerceptionLeasesOut
from .ai import _worker_authorized, construire_manifeste

router = APIRouter(prefix="/ai", tags=["perception"])

# Un bail vaut trois battements. Un worker tué brutalement libère donc ses
# robots en moins d'une minute, sans qu'un renouvellement en retard sur un
# réseau lent ne le dépossède pour autant.
DUREE_BAIL = timedelta(seconds=45)
CAPACITE_MAX = 64


def _maintenant() -> datetime:
    return datetime.now(timezone.utc)


def _expire(valeur: datetime) -> datetime:
    """Compare des instants venus de la base, qui peuvent être naïfs.

    SQLite rend des datetime sans fuseau là où PostgreSQL en porte un. Comparer
    les deux lève un TypeError, et ce module compare des échéances à chaque
    appel : on ramène tout en UTC plutôt que de découvrir la panne en production.
    """
    return valeur if valeur.tzinfo else valeur.replace(tzinfo=timezone.utc)


def _robots_a_couvrir(db: Session) -> list[Robot]:
    """Robots dont le manifeste résout au moins un modèle.

    Un robot sans Box affectée n'a rien à faire analyser : lui attribuer un
    worker consommerait une place pour ouvrir une session vidéo inutile.
    """
    robots = db.execute(select(Robot)).scalars().all()
    return [robot for robot in robots if construire_manifeste(db, robot)["models"]]


def _baux_vivants(db: Session, instant: datetime) -> list[PerceptionLease]:
    return [bail for bail in db.execute(select(PerceptionLease)).scalars().all()
            if _expire(bail.expires_at) > instant]


@router.post("/runtime/workers/{worker_id}/leases", response_model=PerceptionLeasesOut)
def renouveler_baux(worker_id: str, body: PerceptionLeaseIn, db: Session = Depends(get_db),
                    _=Depends(_worker_authorized)):
    """Battement de cœur et attribution, en un seul appel.

    Un seul aller-retour fait les deux parce qu'ils sont indissociables : un
    worker qui annonce sa présence annonce en même temps ce qu'il peut porter,
    et repart avec la liste exacte des robots dont il a la charge. Deux appels
    séparés auraient laissé une fenêtre où l'un est à jour et l'autre non.
    """
    capacite = max(0, min(CAPACITE_MAX, body.capacite))
    instant = _maintenant()
    echeance = instant + DUREE_BAIL

    vivants = _baux_vivants(db, instant)
    for bail in db.execute(select(PerceptionLease)).scalars().all():
        if bail not in vivants:
            db.delete(bail)

    miens = [bail for bail in vivants if bail.worker_id == worker_id]
    for bail in miens:
        bail.renewed_at = instant
        bail.expires_at = echeance

    # Un robot déjà servi reste chez son worker tant que le bail se renouvelle.
    # Rééquilibrer pour un gain théorique couperait une session vidéo en cours.
    places = capacite - len(miens)
    if places > 0:
        pris = {bail.robot_id for bail in vivants}
        for robot in _robots_a_couvrir(db):
            if places <= 0:
                break
            if robot.id in pris:
                continue
            db.add(PerceptionLease(robot_id=robot.id, worker_id=worker_id,
                                   acquired_at=instant, renewed_at=instant,
                                   expires_at=echeance))
            places -= 1

    db.commit()
    robots = db.execute(
        select(PerceptionLease.robot_id).where(PerceptionLease.worker_id == worker_id)
    ).scalars().all()
    return {"worker_id": worker_id, "robots": sorted(robots),
            "renouveler_dans": int(DUREE_BAIL.total_seconds() // 3)}


@router.delete("/runtime/workers/{worker_id}/leases", status_code=204)
def rendre_baux(worker_id: str, db: Session = Depends(get_db), _=Depends(_worker_authorized)):
    """Restitution à l'arrêt propre, pour ne pas attendre l'expiration.

    Un worker qu'on arrête volontairement sait qu'il part. Rendre ses robots
    tout de suite épargne à la flotte les quarante-cinq secondes d'aveuglement
    que coûterait l'expiration.
    """
    for bail in db.execute(
        select(PerceptionLease).where(PerceptionLease.worker_id == worker_id)
    ).scalars().all():
        db.delete(bail)
    db.commit()


@router.get("/perception/coverage", response_model=PerceptionCoverageOut)
def couverture(db: Session = Depends(get_db), _=Depends(require("api:ai.model.read"))):
    """Qui couvre quoi, et surtout ce que personne ne couvre.

    La colonne qui compte est `decouverts` : elle répond à la question que
    personne n'a pu se poser le 23 septembre, faute d'endroit où la poser.
    """
    instant = _maintenant()
    vivants = {bail.robot_id: bail for bail in _baux_vivants(db, instant)}
    attendus = _robots_a_couvrir(db)

    couverts, decouverts = [], []
    for robot in attendus:
        bail = vivants.get(robot.id)
        if bail is None:
            decouverts.append({"robot_id": robot.id, "nom": robot.nom})
            continue
        couverts.append({
            "robot_id": robot.id, "nom": robot.nom, "worker_id": bail.worker_id,
            "depuis": _expire(bail.acquired_at), "expire_a": _expire(bail.expires_at),
        })

    workers = sorted({bail.worker_id for bail in vivants.values()})
    return {"couverts": couverts, "decouverts": decouverts, "workers": workers}
