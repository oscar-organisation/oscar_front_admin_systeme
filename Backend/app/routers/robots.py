import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import request_organisation_id, require, write_audit
from ..livekit_admin import list_participants
from ..livekit_rooms import robot_room, room_slug
from ..models import LiveKitToken, Robot, RobotAssignment, Site, User
from ..schemas import (
    LiveKitTokenOut,
    RobotAssignIn,
    RobotIn,
    RobotOut,
    TokenIssueIn,
    TokenPairOut,
)
from ..security import create_livekit_token

router = APIRouter(tags=["robots"])


def _conn_info(room: str, identity: str, token: str) -> dict:
    """Bloc d'informations de connexion LiveKit générique (copiable côté client)."""
    return {
        "livekit_url": settings.livekit_url,
        "room": room,
        "identity": identity,
        "api_key": settings.livekit_api_key,
        "token": token,
        "env": {
            "OSCAR_LIVEKIT_URL": settings.livekit_url,
            "OSCAR_LIVEKIT_ROOM": room,
            "OSCAR_IDENTITY": identity,
            "OSCAR_LIVEKIT_TOKEN": token,
        },
    }


@router.get("/robots", response_model=list[RobotOut])
def list_robots(request: Request, org_id: str | None = None, site_id: str | None = None,
                db: Session = Depends(get_db), _=Depends(require("api:robot.read"))):
    q = select(Robot).order_by(Robot.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        q = q.where(Robot.org_id == scoped_org_id)
    elif org_id:
        q = q.where(Robot.org_id == org_id)
    if site_id:
        q = q.where(Robot.site_id == site_id)
    return db.execute(q).scalars().all()


@router.post("/robots", response_model=RobotOut, status_code=201)
def create_robot(body: RobotIn, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "create"))):
    data = body.model_dump()
    if not data.get("serial"):
        data["serial"] = None  # série vide -> NULL (pas de doublon sur chaîne vide)
    robot = Robot(**data)
    db.add(robot)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Numéro de série déjà utilisé")
    db.refresh(robot)
    write_audit(db, actor=user, action="ROBOT_CREATE", resource=robot.nom)
    return robot


@router.get("/robots/assigned", response_model=list[RobotOut])
def assigned_robots(request: Request, db: Session = Depends(get_db),
                    user=Depends(require("api:robot.supervise", "execute"))):
    """Robots auxquels l'utilisateur courant est associé (tous si superadmin)."""
    scoped_org_id = request_organisation_id(request)
    if user.is_superadmin:
        query = select(Robot).order_by(Robot.nom)
        if scoped_org_id:
            query = query.where(Robot.org_id == scoped_org_id)
        return db.execute(query).scalars().all()
    ids = [a.robot_id for a in db.execute(
        select(RobotAssignment).where(RobotAssignment.user_id == user.id)).scalars()]
    if not ids:
        return []
    query = select(Robot).where(Robot.id.in_(ids)).order_by(Robot.nom)
    if scoped_org_id:
        query = query.where(Robot.org_id == scoped_org_id)
    return db.execute(query).scalars().all()


@router.get("/robots/{robot_id}", response_model=RobotOut)
def get_robot(robot_id: str, db: Session = Depends(get_db), _=Depends(require("api:robot.read"))):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    return robot


@router.patch("/robots/{robot_id}", response_model=RobotOut)
def update_robot(robot_id: str, body: RobotIn, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "update"))):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    data = body.model_dump(exclude_unset=True)
    if "serial" in data and not data["serial"]:
        data["serial"] = None
    for k, v in data.items():
        setattr(robot, k, v)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Numéro de série déjà utilisé")
    db.refresh(robot)
    write_audit(db, actor=user, action="ROBOT_UPDATE", resource=robot.nom)
    return robot


@router.delete("/robots/{robot_id}", status_code=204)
def delete_robot(robot_id: str, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "delete"))):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    db.delete(robot)
    db.commit()
    write_audit(db, actor=user, action="ROBOT_DELETE", resource=robot.nom)


@router.post("/robots/{robot_id}/assign", status_code=204)
def assign_operator(robot_id: str, body: RobotAssignIn, db: Session = Depends(get_db),
                    user=Depends(require("api:robot.assign", "execute"))):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    if not db.get(User, body.user_id):
        raise HTTPException(404, "Utilisateur introuvable")
    existing = db.execute(
        select(RobotAssignment).where(
            RobotAssignment.robot_id == robot_id, RobotAssignment.user_id == body.user_id
        )
    ).scalar_one_or_none()
    if existing:
        existing.op_role = body.op_role
    else:
        db.add(RobotAssignment(robot_id=robot_id, user_id=body.user_id, op_role=body.op_role))
    db.commit()
    write_audit(db, actor=user, action="ROBOT_ASSIGN", resource=f"{robot.nom}:{body.user_id}")


@router.delete("/robots/{robot_id}/assignments/{user_id}", status_code=204)
def unassign_operator(robot_id: str, user_id: str, db: Session = Depends(get_db),
                      user=Depends(require("api:robot.assign", "execute"))):
    """Dissocier un opérateur d'un robot."""
    row = db.execute(select(RobotAssignment).where(
        RobotAssignment.robot_id == robot_id, RobotAssignment.user_id == user_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Association introuvable")
    db.delete(row)
    db.commit()
    write_audit(db, actor=user, action="ROBOT_UNASSIGN", resource=f"{robot_id}:{user_id}")


@router.post("/robots/{robot_id}/tokens", response_model=TokenPairOut)
def issue_tokens(robot_id: str, body: TokenIssueIn, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.token.issue", "execute"))):
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    room = robot_room(robot)  # room stable : robot et opérateur rejoignent la même
    now = datetime.now(timezone.utc)

    # jeton robot : publie vidéo/audio/pose
    robot_identity = f"robot-{room_slug(robot.nom)}"
    robot_jwt = create_livekit_token(
        robot_identity, room, can_publish=True, can_subscribe=True,
        can_publish_data=True, ttl_hours=settings.livekit_robot_ttl_hours, name=robot.nom,
    )
    robot_row = LiveKitToken(
        robot_id=robot.id, room=room, subject="robot", identity=robot_identity, token=robot_jwt,
        expires_at=now + timedelta(hours=settings.livekit_robot_ttl_hours),
    )
    db.add(robot_row)

    operator_row = None
    if body.operator_id:
        op = db.get(User, body.operator_id)
        if not op:
            raise HTTPException(404, "Opérateur introuvable")
        op_identity = f"operator-{op.id}"
        op_jwt = create_livekit_token(
            op_identity, room, can_publish=False, can_subscribe=True,
            can_publish_data=True, ttl_hours=settings.livekit_operator_ttl_hours, name=op.nom,
        )
        operator_row = LiveKitToken(
            robot_id=robot.id, room=room, subject="operator", identity=op_identity, token=op_jwt,
            expires_at=now + timedelta(hours=settings.livekit_operator_ttl_hours),
        )
        db.add(operator_row)

    db.commit()
    db.refresh(robot_row)
    if operator_row:
        db.refresh(operator_row)
    write_audit(db, actor=user, action="TOKEN_ISSUE", resource=f"{robot.nom}:{room}")
    return TokenPairOut(
        room=room, livekit_url=settings.livekit_url,
        robot=robot_row, operator=operator_row,
    )


@router.get("/robots/{robot_id}/tokens", response_model=list[LiveKitTokenOut])
def list_tokens(robot_id: str, db: Session = Depends(get_db), _=Depends(require("api:robot.read"))):
    return db.execute(
        select(LiveKitToken).where(LiveKitToken.robot_id == robot_id)
        .order_by(LiveKitToken.created_at.desc())
    ).scalars().all()


@router.post("/tokens/{token_id}/revoke", status_code=204)
def revoke_token(token_id: str, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.token.issue", "execute"))):
    tok = db.get(LiveKitToken, token_id)
    if not tok:
        raise HTTPException(404, "Jeton introuvable")
    tok.revoked = True
    db.commit()
    write_audit(db, actor=user, action="TOKEN_REVOKE", resource=tok.room)


@router.get("/robots/{robot_id}/diagnostics")
def robot_diagnostics(robot_id: str, db: Session = Depends(get_db),
                      _=Depends(require("api:robot.read"))):
    """Santé + état LiveKit d'un robot : room stable, clients connectés, ce que chacun publie."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    room = robot_room(robot)
    reachable, parts = list_participants(room)

    clients = []
    robot_present = False
    for p in parts:
        identity = p.get("identity", "")
        is_robot = identity.startswith("robot-")
        robot_present = robot_present or is_robot
        tracks = [
            {"type": t.get("type"), "source": t.get("source"),
             "muted": t.get("muted", False), "name": t.get("name", "")}
            for t in (p.get("tracks") or [])
        ]
        clients.append({
            "identity": identity,
            "name": p.get("name") or identity,
            "state": p.get("state"),
            "is_robot": is_robot,
            "tracks": tracks,
            "joined_at": p.get("joinedAt"),
        })

    tokens_actifs = db.execute(
        select(func.count()).select_from(LiveKitToken)
        .where(LiveKitToken.robot_id == robot.id, LiveKitToken.revoked.is_(False))
    ).scalar() or 0

    health = {
        "livekit": "ok" if reachable else "injoignable",
        "robot": "en_ligne" if robot_present else ("declare_en_ligne" if robot.statut == "online" else "hors_ligne"),
        "commande": "actif" if robot_present else "en_attente",
        "sdk": "connecte" if robot_present else "en_attente",  # SDK pas encore implémenté
    }
    return {
        "robot": {"id": robot.id, "nom": robot.nom, "statut": robot.statut,
                  "batterie": robot.batterie, "firmware": robot.firmware,
                  "capacites": robot.capacites},
        "room": room,
        "livekit_url": settings.livekit_url,
        "reachable": reachable,
        "clients": clients,
        "clients_count": len(clients),
        "tokens_actifs": tokens_actifs,
        "health": health,
    }


@router.post("/robots/{robot_id}/supervise")
def supervise(robot_id: str, request: Request, db: Session = Depends(get_db),
              user=Depends(require("api:robot.supervise", "execute"))):
    """Jeton d'accès (opérateur) à la room du robot, si l'utilisateur y est associé."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id and robot.org_id != scoped_org_id:
        raise HTTPException(404, "Robot introuvable dans cette organisation")
    if not user.is_superadmin:
        assigned = db.execute(select(RobotAssignment).where(
            RobotAssignment.robot_id == robot_id, RobotAssignment.user_id == user.id)).first()
        if not assigned:
            raise HTTPException(403, "Vous n'êtes pas associé à ce robot")
    room = robot_room(robot)
    # LiveKit permits a single active participant per identity. A unique
    # suffix keeps simultaneous 2D and XR supervision sessions independent.
    identity = f"operator-{user.id}-{uuid.uuid4().hex[:10]}"
    token = create_livekit_token(identity, room, can_publish=False, can_subscribe=True,
                                 can_publish_data=True, ttl_hours=settings.livekit_operator_ttl_hours,
                                 name=user.nom)
    write_audit(db, actor=user, action="SUPERVISE", resource=f"{robot.nom}:{room}")
    return {
        "room": room,
        "livekit_url": settings.livekit_url,
        "identity": identity,
        "token": token,
        "robot": {"id": robot.id, "nom": robot.nom, "statut": robot.statut,
                  "batterie": robot.batterie, "firmware": robot.firmware},
    }


@router.get("/robots/{robot_id}/integration")
def integration(robot_id: str, db: Session = Depends(get_db),
                user=Depends(require("api:robot.integration"))):
    """Détails de connexion pour intégrer le SDK au robot (room realtime dédiée)."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    room = robot_room(robot)
    identity = f"robot-{room_slug(robot.nom)}"
    token = create_livekit_token(identity, room, can_publish=True, can_subscribe=True,
                                 can_publish_data=True, ttl_hours=settings.livekit_sdk_ttl_hours,
                                 name=robot.nom)
    write_audit(db, actor=user, action="INTEGRATION_VIEW", resource=robot.nom)
    return {
        "robot": {"id": robot.id, "nom": robot.nom},
        "livekit_url": settings.livekit_url,
        "room": room,
        "identity": identity,
        "api_key": settings.livekit_api_key,
        "token": token,
        "ttl_hours": settings.livekit_sdk_ttl_hours,
        "env": {
            "OSCAR_LIVEKIT_URL": settings.livekit_url,
            "OSCAR_LIVEKIT_ROOM": room,
            "OSCAR_ROBOT_IDENTITY": identity,
            "OSCAR_LIVEKIT_TOKEN": token,
        },
    }


@router.get("/robots/{robot_id}/assignments")
def robot_assignments(robot_id: str, db: Session = Depends(get_db),
                      _=Depends(require("api:robot.read"))):
    """Utilisateurs (opérateurs) associés à un robot."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    rows = db.execute(
        select(RobotAssignment, User).join(User, User.id == RobotAssignment.user_id)
        .where(RobotAssignment.robot_id == robot_id)
    ).all()
    return [{"user_id": u.id, "nom": u.nom, "email": u.email, "op_role": a.op_role} for a, u in rows]


@router.get("/robots/{robot_id}/integration/operator/{user_id}")
def integration_operator(robot_id: str, user_id: str, db: Session = Depends(get_db),
                         actor=Depends(require("api:robot.integration"))):
    """Infos de connexion (opérateur) pour un utilisateur donné : à utiliser dans l'app casque/opérateur."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "Utilisateur introuvable")
    room = robot_room(robot)
    identity = f"operator-{user.id}"
    token = create_livekit_token(identity, room, can_publish=False, can_subscribe=True,
                                 can_publish_data=True, ttl_hours=settings.livekit_operator_ttl_hours,
                                 name=user.nom)
    info = _conn_info(room, identity, token)
    info.update(kind="operator", ttl_hours=settings.livekit_operator_ttl_hours,
                user={"id": user.id, "nom": user.nom, "email": user.email})
    return info


@router.post("/robots/{robot_id}/integration/custom")
def integration_custom(robot_id: str, body: dict, db: Session = Depends(get_db),
                       actor=Depends(require("api:robot.integration"))):
    """Génère les infos de connexion pour un autre équipement/client qui rejoint la room du robot."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Le nom de l'équipement est requis")
    can_publish = bool(body.get("can_publish", False))
    identity = "client-" + (room_slug(body.get("identity")) if body.get("identity") else room_slug(name))
    room = robot_room(robot)
    token = create_livekit_token(identity, room, can_publish=can_publish, can_subscribe=True,
                                 can_publish_data=True, ttl_hours=settings.livekit_sdk_ttl_hours, name=name)
    write_audit(db, actor=actor, action="INTEGRATION_CUSTOM", resource=f"{robot.nom}:{name}")
    info = _conn_info(room, identity, token)
    info.update(kind="custom", name=name, can_publish=can_publish, ttl_hours=settings.livekit_sdk_ttl_hours)
    return info
