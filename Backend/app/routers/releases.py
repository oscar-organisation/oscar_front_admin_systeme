"""Distribution du paquet embarqué : de la console jusqu'au robot.

La console distribuait jusqu'ici de la configuration. Distribuer du **code**
exécutable demande trois garanties de plus, et ce module les pose :

1. **l'empreinte voyage à part de l'archive** — le robot refuse ce qui ne
   correspond pas à ce qui a été publié ;
2. **l'empreinte est authentifiée** par la clé propre au robot, pour qu'un
   intermédiaire ne puisse pas annoncer une autre archive que celle publiée ;
3. **la mise à jour se fait par canal** — un robot témoin en `beta` avant que
   la flotte en `stable` ne suive.

Le retour arrière, lui, appartient au robot : c'est lui qui sait si la version
installée démarre, et lui seul peut revenir à la précédente.
"""

import hashlib
import hmac
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import require, write_audit
from ..models import EdgeRelease, Robot
from ..schemas import EdgeReleaseOut

router = APIRouter(prefix="/edge-releases", tags=["paquet-embarque"])

VERSION_VALIDE = re.compile(r"^\d+\.\d+\.\d+(-[a-z0-9.]+)?$")
CANAUX = ("stable", "beta")


def _release_du_canal(db: Session, canal: str) -> EdgeRelease | None:
    """Dernière version publiée sur ce canal.

    « Dernière » au sens de la publication, pas du numéro : republier une
    version antérieure est une façon légitime de faire reculer une flotte.
    """
    return db.execute(
        select(EdgeRelease)
        .where(EdgeRelease.canal == canal, EdgeRelease.statut == "published")
        .order_by(EdgeRelease.published_at.desc())
    ).scalars().first()


def _empreinte_signee(sha256: str, cle_robot_hash: str) -> str:
    """Preuve que cette empreinte vient bien de la console.

    La clé du robot n'est connue que de lui et du serveur ; signer l'empreinte
    avec elle empêche un intermédiaire d'annoncer une archive qu'il aurait
    fabriquée. Une signature asymétrique serait plus forte — elle survivrait à
    la compromission du serveur — et c'est la suite prévue.
    """
    return hmac.new(cle_robot_hash.encode("utf-8"), sha256.encode("utf-8"), hashlib.sha256).hexdigest()


def _sortie(release: EdgeRelease) -> dict:
    return {
        "id": release.id, "version": release.version, "canal": release.canal,
        "statut": release.statut, "sha256": release.sha256, "taille": release.taille,
        "archive_nom": release.archive_nom, "notes": release.notes,
        "published_at": release.published_at, "created_at": release.created_at,
    }


@router.get("", response_model=list[EdgeReleaseOut])
def list_releases(db: Session = Depends(get_db), _=Depends(require("api:edge_release.read"))):
    releases = db.execute(select(EdgeRelease).order_by(EdgeRelease.created_at.desc())).scalars().all()
    return [_sortie(release) for release in releases]


@router.post("", response_model=EdgeReleaseOut, status_code=201)
async def upload_release(
    request: Request,
    version: str = Form(...),
    canal: str = Form("stable"),
    notes: str | None = Form(None),
    file: UploadFile = File(...),
    user=Depends(require("api:edge_release.write", "execute")),
    db: Session = Depends(get_db),
):
    """Dépose une archive de paquet embarqué. Elle n'atteint aucun robot avant publication."""
    version = version.strip()
    if not VERSION_VALIDE.match(version):
        raise HTTPException(400, "Version attendue au format 1.2.3")
    if canal not in CANAUX:
        raise HTTPException(400, f"Canal inconnu : {canal}")
    if db.execute(select(EdgeRelease).where(EdgeRelease.version == version)).scalar_one_or_none():
        raise HTTPException(409, f"La version {version} existe déjà")

    nom = Path(file.filename or "").name
    if not nom.endswith(".tar.gz"):
        raise HTTPException(400, "Une release est une archive .tar.gz")

    dossier = Path(settings.edge_release_dir)
    dossier.mkdir(parents=True, exist_ok=True)
    chemin = dossier / f"oscar-edge-{version}.tar.gz"
    if chemin.exists():
        raise HTTPException(409, "Une archive porte déjà ce nom")

    limite = settings.edge_release_max_mb * 1024 * 1024
    digest = hashlib.sha256()
    taille = 0
    try:
        with chemin.open("wb") as sortie:
            while morceau := await file.read(1024 * 1024):
                taille += len(morceau)
                if taille > limite:
                    raise HTTPException(413, f"Archive au-delà de {settings.edge_release_max_mb} Mo")
                digest.update(morceau)
                sortie.write(morceau)
    except Exception:
        chemin.unlink(missing_ok=True)
        raise

    release = EdgeRelease(
        version=version, canal=canal, statut="draft", fichier=str(chemin),
        archive_nom=nom, sha256=digest.hexdigest(), taille=taille,
        notes=notes, created_by=user.id,
    )
    db.add(release)
    db.commit()
    db.refresh(release)
    write_audit(db, actor=user, action="EDGE_RELEASE_UPLOAD", resource=f"{version} ({canal})")
    return _sortie(release)


@router.post("/{release_id}/publish", response_model=EdgeReleaseOut)
def publish_release(release_id: str, db: Session = Depends(get_db),
                    user=Depends(require("api:edge_release.write", "execute"))):
    """Met cette version en service sur son canal.

    C'est le seul geste qui fait bouger des robots : à partir de là, chacun
    d'eux la récupérera à son prochain passage.
    """
    release = db.get(EdgeRelease, release_id)
    if not release:
        raise HTTPException(404, "Paquet introuvable")
    if not Path(release.fichier).exists():
        raise HTTPException(409, "L'archive de ce paquet est absente du stockage")
    release.statut = "published"
    release.published_at = datetime.now(timezone.utc)
    release.published_by = user.id
    db.commit()
    db.refresh(release)
    concernes = db.execute(
        select(Robot).where(Robot.edge_channel == release.canal)
    ).scalars().all()
    write_audit(db, actor=user, action="EDGE_RELEASE_PUBLISH",
                resource=f"{release.version} → canal {release.canal} ({len(concernes)} robot(s))")
    return _sortie(release)


@router.post("/{release_id}/archive", response_model=EdgeReleaseOut)
def archive_release(release_id: str, db: Session = Depends(get_db),
                    user=Depends(require("api:edge_release.write", "execute"))):
    """Retire cette version du canal sans la supprimer : un robot peut y être resté."""
    release = db.get(EdgeRelease, release_id)
    if not release:
        raise HTTPException(404, "Paquet introuvable")
    release.statut = "archived"
    db.commit()
    db.refresh(release)
    write_audit(db, actor=user, action="EDGE_RELEASE_ARCHIVE", resource=release.version)
    return _sortie(release)
