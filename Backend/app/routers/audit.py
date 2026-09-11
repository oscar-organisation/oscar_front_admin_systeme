from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require
from ..models import AuditLog
from ..schemas import AuditOut

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=list[AuditOut])
def list_audit(action: str | None = None, actor: str | None = None,
               since: str | None = None, limit: int = 100,
               db: Session = Depends(get_db), _=Depends(require("api:audit.read"))):
    q = select(AuditLog).order_by(AuditLog.ts.desc()).limit(min(limit, 500))
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
