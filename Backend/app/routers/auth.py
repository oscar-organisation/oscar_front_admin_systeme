from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import (
    accessible_organisation_ids,
    compute_permissions,
    compute_role_names,
    get_current_user,
    resolve_active_organisation_id,
    write_audit,
)
from ..models import Organisation, User
from ..schemas import LoginIn, MeOut, OrganisationContextOut, TokenOut
from ..security import create_access_token, decode_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == body.email)).scalar_one_or_none()
    if not user or not user.password_hash or not verify_password(body.password, user.password_hash):
        write_audit(db, actor=None, action="LOGIN_FAILED", resource=body.email,
                    result="denied", ip=request.client.host if request.client else None)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Identifiants invalides")
    if user.statut == "disabled":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Compte désactivé")
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    write_audit(db, actor=user, action="LOGIN", resource=user.email,
                ip=request.client.host if request.client else None)
    return TokenOut(
        access_token=create_access_token(user.id, "access"),
        refresh_token=create_access_token(user.id, "refresh"),
    )


@router.post("/refresh", response_model=TokenOut)
def refresh(body: dict, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body["refresh_token"])
        assert payload.get("type") == "refresh"
        user = db.get(User, payload["sub"])
        assert user
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh invalide")
    return TokenOut(
        access_token=create_access_token(user.id, "access"),
        refresh_token=create_access_token(user.id, "refresh"),
    )


@router.get("/me", response_model=MeOut)
def me(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    active_org_id = resolve_active_organisation_id(request, db, user)
    allowed = accessible_organisation_ids(db, user)
    query = select(Organisation).order_by(Organisation.nom)
    if allowed is not None:
        query = query.where(Organisation.id.in_(allowed))
    organisations = db.execute(query).scalars().all()
    perms = compute_permissions(db, user, active_org_id)
    return MeOut(
        id=user.id, email=user.email, nom=user.nom, org_id=user.org_id,
        active_org_id=active_org_id,
        organisations=[
            OrganisationContextOut(
                id=org.id,
                nom=org.nom,
                slug=org.slug,
                parent_id=org.parent_id,
                is_primary=org.id == user.org_id,
                roles=compute_role_names(db, user, org.id),
                permissions=compute_permissions(db, user, org.id),
            )
            for org in organisations
        ],
        is_superadmin=user.is_superadmin, features=sorted(perms.keys()), permissions=perms,
    )
