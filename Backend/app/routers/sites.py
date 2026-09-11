from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..models import Site
from ..schemas import SiteIn, SiteOut

router = APIRouter(prefix="/sites", tags=["sites"])


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
    site = Site(**body.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    write_audit(db, actor=user, action="SITE_CREATE", resource=site.nom)
    return site


@router.get("/{site_id}", response_model=SiteOut)
def get_site(site_id: str, db: Session = Depends(get_db), _=Depends(require("api:site.read"))):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site introuvable")
    return site


@router.patch("/{site_id}", response_model=SiteOut)
def update_site(site_id: str, body: SiteIn, db: Session = Depends(get_db),
                user=Depends(require("api:site.write", "update"))):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site introuvable")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(site, k, v)
    db.commit()
    db.refresh(site)
    write_audit(db, actor=user, action="SITE_UPDATE", resource=site.nom)
    return site


@router.delete("/{site_id}", status_code=204)
def delete_site(site_id: str, db: Session = Depends(get_db),
                user=Depends(require("api:site.write", "delete"))):
    site = db.get(Site, site_id)
    if not site:
        raise HTTPException(404, "Site introuvable")
    db.delete(site)
    db.commit()
    write_audit(db, actor=user, action="SITE_DELETE", resource=site.nom)
