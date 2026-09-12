from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import request_organisation_id, require, verifier_perimetre, write_audit
from ..models import Site
from ..schemas import SiteIn, SiteOut

router = APIRouter(prefix="/sites", tags=["sites"])


def _site_du_perimetre(db: Session, request: Request, site_id: str) -> Site:
    """Charge un site en verifiant qu'il appartient a l'organisation active."""
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site introuvable")
    verifier_perimetre(request, site.org_id, "Site introuvable")
    return site


@router.get("", response_model=list[SiteOut])
def list_sites(request: Request, org_id: str | None = None, db: Session = Depends(get_db),
               _=Depends(require("api:site.read"))):
    q = select(Site).order_by(Site.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        q = q.where(Site.org_id == scoped_org_id)
    elif org_id:
        q = q.where(Site.org_id == org_id)
    return db.execute(q).scalars().all()


@router.post("", response_model=SiteOut, status_code=201)
def create_site(body: SiteIn, request: Request, db: Session = Depends(get_db),
                user=Depends(require("api:site.write", "create"))):
    donnees = body.model_dump()
    actif = request_organisation_id(request)
    if actif:
        # Le rattachement suit l'organisation active : sans cela un
        # administrateur borne pourrait creer un site chez un voisin.
        donnees["org_id"] = actif
    site = Site(**donnees)
    db.add(site)
    db.commit()
    db.refresh(site)
    write_audit(db, actor=user, action="SITE_CREATE", resource=site.nom)
    return site


@router.get("/{site_id}", response_model=SiteOut)
def get_site(site_id: str, request: Request, db: Session = Depends(get_db),
             _=Depends(require("api:site.read"))):
    site = _site_du_perimetre(db, request, site_id)
    return site


@router.patch("/{site_id}", response_model=SiteOut)
def update_site(site_id: str, body: SiteIn, request: Request, db: Session = Depends(get_db),
                user=Depends(require("api:site.write", "update"))):
    site = _site_du_perimetre(db, request, site_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(site, k, v)
    db.commit()
    db.refresh(site)
    write_audit(db, actor=user, action="SITE_UPDATE", resource=site.nom)
    return site


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: str, request: Request, db: Session = Depends(get_db),
                user=Depends(require("api:site.write", "delete"))):
    site = _site_du_perimetre(db, request, site_id)
    db.delete(site)
    db.commit()
    write_audit(db, actor=user, action="SITE_DELETE", resource=site.nom)
