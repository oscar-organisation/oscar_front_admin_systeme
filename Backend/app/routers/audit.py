from datetime import datetime

from fastapi import APIRouter, Depends, Request
from sqlalchemy import false as sa_false, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import accessible_organisation_ids, require
from ..models import AuditLog
from ..schemas import AuditOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
def list_audit(request: Request, action: str | None = None, actor: str | None = None,
               since: str | None = None, limit: int = 100,
               db: Session = Depends(get_db), user=Depends(require("api:audit.read"))):
    q = select(AuditLog).order_by(AuditLog.ts.desc()).limit(min(limit, 500))
    autorisees = accessible_organisation_ids(db, user)
    if autorisees is not None:
        # Les lignes sans organisation (actions systeme, ou anterieures a la
        # colonne) ne sont servies qu'au super administrateur : mieux vaut une
        # trace incomplete qu'une trace qui traverse les locataires.
        q = q.where(AuditLog.org_id.in_(autorisees)) if autorisees else q.where(sa_false())
    if action:
        q = q.where(AuditLog.action == action)
    if actor:
        q = q.where(AuditLog.actor_label.ilike(f"%{actor}%"))
    if since:
        try:
            q = q.where(AuditLog.ts >= datetime.fromisoformat(since))
        except ValueError:
            pass  # date invalide : on ignore le filtre plutôt que de renvoyer une erreur
    return db.execute(q).scalars().all()
