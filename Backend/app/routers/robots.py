import hashlib
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import (
    request_organisation_id,
    require,
    sans_perimetre,
    verifier_perimetre,
    write_audit,
)
from ..livekit_admin import list_participants
from ..livekit_rooms import robot_room, room_slug
from ..models import CompositionPreset, LiveKitToken, Robot, RobotAssignment, Site, User
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


def _robot_du_perimetre(db: Session, request: Request, robot_id: str) -> Robot:
    """Charge un robot en verifiant qu'il appartient a l'organisation active."""
    robot = db.get(Robot, robot_id)
    if not robot:
        raise HTTPException(404, "Robot introuvable")
    verifier_perimetre(request, robot.org_id, "Robot introuvable")
    return robot


@router.get("/robots", response_model=list[RobotOut])
def list_robots(request: Request, org_id: str | None = None, site_id: str | None = None,
                db: Session = Depends(get_db), _=Depends(require("api:robot.read"))):
    if sans_perimetre(request):
        return []
    q = select(Robot).order_by(Robot.nom)
    scoped_org_id = request_organisation_id(request)
    if scoped_org_id:
        q = q.where(Robot.org_id == scoped_org_id)
    elif org_id:
        q = q.where(Robot.org_id == org_id)
    if site_id:
        q = q.where(Robot.site_id == site_id)
    return db.execute(q).scalars().all()


def _slug_robot(db: Session, nom: str) -> str:
    """Identifiant terrain d'un robot, derive de son nom.

    L'agent embarque n'attend pas un UUID mais un identifiant lisible
    (`^[a-z0-9][a-z0-9-]{2,62}$`) : c'est ce qu'il inscrit dans son enrolement
    et dans `/opt/oscar`. On le derive une fois, a la creation, et on le garde.
    """
    base = re.sub(r"[^a-z0-9]+", "-", (nom or "").lower()).strip("-")[:62]
    if len(base) < 3:
        base = f"robot-{uuid.uuid4().hex[:6]}"
    candidat, suffixe = base, 2
    while db.execute(select(Robot).where(Robot.slug == candidat)).first():
        candidat = f"{base[:58]}-{suffixe}"
        suffixe += 1
    return candidat


def _normaliser_modele(valeur: str | None) -> str | None:
    """Ramene une famille de chassis a sa forme canonique.

    L'operateur ecrit « ROSMASTER M3 Pro », le profil embarque et l'image du
    runtime connaissent « rosmaster-m3pro ». Sans cette normalisation les trois
    couches cessent de se reconnaitre, et le catalogue de presets ne retrouve
    plus les robots de la famille qu'il vise.
    """
    if valeur is None:
        return None
    canonique = re.sub(r"[^a-z0-9]+", "-", valeur.lower()).strip("-")[:80]
    return canonique or None


@router.get("/robots/modeles", response_model=list[str])
def list_modeles(db: Session = Depends(get_db), _=Depends(require("api:robot.read"))):
    """Familles de châssis déjà connues, pour que l'opérateur choisisse.

    La normalisation ne suffit pas à garantir l'identifiant canonique : rien ne
    permet de deviner que « ROSMASTER M3 Pro » s'écrit `rosmaster-m3pro` et non
    `rosmaster-m3-pro`, le constructeur ayant collé deux mots. La saisie libre
    reste donc possible, mais le choix passe d'abord par cette liste.

    Elle réunit deux sources : les familles déjà portées par des robots, et
    celles que le catalogue de présets sait outiller. Proposer une famille pour
    laquelle aucun préset n'existe reste légitime, l'inverse aussi.
    """
    portees = db.execute(
        select(Robot.modele).where(Robot.modele.is_not(None)).distinct()
    ).scalars().all()
    outillees = db.execute(
        select(CompositionPreset.famille).where(
            CompositionPreset.statut == "published"
        ).distinct()
    ).scalars().all()
    return sorted({valeur for valeur in [*portees, *outillees] if valeur})


@router.post("/robots", response_model=RobotOut, status_code=201)
def create_robot(body: RobotIn, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "create"))):
    data = body.model_dump()
    if not data.get("serial"):
        data["serial"] = None  # série vide -> NULL (pas de doublon sur chaîne vide)
    data.pop("slug", None)  # le slug est dérivé, jamais choisi par l'appelant
    data["modele"] = _normaliser_modele(data.get("modele"))
    robot = Robot(**data, slug=_slug_robot(db, data.get("nom", "")))
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
    if sans_perimetre(request):
        return []
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
def get_robot(robot_id: str, request: Request, db: Session = Depends(get_db),
              _=Depends(require("api:robot.read"))):
    robot = _robot_du_perimetre(db, request, robot_id)
    return robot


@router.patch("/robots/{robot_id}", response_model=RobotOut)
def update_robot(robot_id: str, body: RobotIn, request: Request, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "update"))):
    robot = _robot_du_perimetre(db, request, robot_id)
    data = body.model_dump(exclude_unset=True)
    if "serial" in data and not data["serial"]:
        data["serial"] = None
    # Renommer un robot ne renomme pas son identifiant terrain : l'agent
    # embarque l'a inscrit dans ses chemins et son enrolement, et un robot qui
    # change d'identite au milieu d'une flotte est un robot qu'on perd.
    data.pop("slug", None)
    if "modele" in data:
        data["modele"] = _normaliser_modele(data["modele"])
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
def delete_robot(robot_id: str, request: Request, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.write", "delete"))):
    robot = _robot_du_perimetre(db, request, robot_id)
    db.delete(robot)
    db.commit()
    write_audit(db, actor=user, action="ROBOT_DELETE", resource=robot.nom)


@router.post("/robots/{robot_id}/assign", status_code=204)
def assign_operator(robot_id: str, body: RobotAssignIn, request: Request, db: Session = Depends(get_db),
                    user=Depends(require("api:robot.assign", "execute"))):
    robot = _robot_du_perimetre(db, request, robot_id)
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
def unassign_operator(robot_id: str, user_id: str, request: Request, db: Session = Depends(get_db),
                      user=Depends(require("api:robot.assign", "execute"))):
    """Dissocier un opérateur d'un robot."""
    _robot_du_perimetre(db, request, robot_id)
    row = db.execute(select(RobotAssignment).where(
        RobotAssignment.robot_id == robot_id, RobotAssignment.user_id == user_id)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Association introuvable")
    db.delete(row)
    db.commit()
    write_audit(db, actor=user, action="ROBOT_UNASSIGN", resource=f"{robot_id}:{user_id}")


@router.post("/robots/{robot_id}/tokens", response_model=TokenPairOut)
def issue_tokens(robot_id: str, body: TokenIssueIn, request: Request, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.token.issue", "execute"))):
    robot = _robot_du_perimetre(db, request, robot_id)
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


@router.post("/robots/{robot_id}/edge-credentials")
def issue_edge_credentials(robot_id: str, request: Request, db: Session = Depends(get_db),
                           user=Depends(require("api:robot.token.issue", "execute"))):
    """Identifiants LiveKit de l'agent embarqué, dans la forme qu'il attend.

    Le runtime embarqué tient deux rôles dans la même room : il publie la vidéo
    et il reçoit les commandes. LiveKit n'admet qu'un participant par identité —
    leur en donner une seule ferait que le second évince le premier à chaque
    connexion. D'où deux identités distinctes, émises ensemble.

    Jusqu'ici ces deux fichiers étaient déposés à la main sur le robot ; c'est
    la derniere etape manuelle de l'enrôlement, et elle disparaît ici.
    """
    robot = _robot_du_perimetre(db, request, robot_id)
    room = robot_room(robot)
    base = room_slug(robot.nom)
    maintenant = datetime.now(timezone.utc)
    heures = settings.livekit_sdk_ttl_hours

    fichiers = {}
    for role, identite, publie in (
        ("media", f"robot-{base}", True),
        ("command", f"robot-{base}-command", True),
    ):
        jeton = create_livekit_token(
            identite, room, can_publish=publie, can_subscribe=True,
            can_publish_data=True, ttl_hours=heures, name=robot.nom,
        )
        db.add(LiveKitToken(
            robot_id=robot.id, room=room, subject="robot", identity=identite, token=jeton,
            expires_at=maintenant + timedelta(hours=heures),
        ))
        fichiers[role] = {"livekit": {
            "serverUrl": settings.livekit_url,
            "roomName": room,
            "identity": identite,
            "token": jeton,
        }}
    db.commit()
    write_audit(db, actor=user, action="EDGE_CREDENTIALS_ISSUE", resource=f"{robot.nom}:{room}")
    return {
        "robot": {"id": robot.id, "nom": robot.nom, "slug": robot.slug},
        "room": room,
        "ttl_hours": heures,
        "fichiers": {
            "/etc/oscar/credentials/media.json": fichiers["media"],
            "/etc/oscar/credentials/command.json": fichiers["command"],
        },
    }


@router.get("/robots/{robot_id}/tokens", response_model=list[LiveKitTokenOut])
def list_tokens(robot_id: str, request: Request, db: Session = Depends(get_db),
                _=Depends(require("api:robot.read"))):
    _robot_du_perimetre(db, request, robot_id)
    return db.execute(
        select(LiveKitToken).where(LiveKitToken.robot_id == robot_id)
        .order_by(LiveKitToken.created_at.desc())
    ).scalars().all()


@router.post("/tokens/{token_id}/revoke", status_code=204)
def revoke_token(token_id: str, request: Request, db: Session = Depends(get_db),
                 user=Depends(require("api:robot.token.issue", "execute"))):
    tok = db.get(LiveKitToken, token_id)
    if not tok:
        raise HTTPException(404, "Jeton introuvable")
    # Le jeton n'est qu'un detour vers le robot : le perimetre se verifie sur lui.
    _robot_du_perimetre(db, request, tok.robot_id)
    tok.revoked = True
    db.commit()
    write_audit(db, actor=user, action="TOKEN_REVOKE", resource=tok.room)


@router.get("/robots/{robot_id}/diagnostics")
def robot_diagnostics(robot_id: str, request: Request, db: Session = Depends(get_db),
                      _=Depends(require("api:robot.read"))):
    """Santé + état LiveKit d'un robot : room stable, clients connectés, ce que chacun publie."""
    robot = _robot_du_perimetre(db, request, robot_id)
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
    robot = _robot_du_perimetre(db, request, robot_id)
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
def integration(robot_id: str, request: Request, db: Session = Depends(get_db),
                user=Depends(require("api:robot.integration"))):
    """Détails de connexion pour intégrer le SDK au robot (room realtime dédiée)."""
    robot = _robot_du_perimetre(db, request, robot_id)
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


@router.post("/robots/{robot_id}/agent-key")
def issue_agent_key(robot_id: str, request: Request, db: Session = Depends(get_db),
                    user=Depends(require("api:robot.agent_key", "execute"))):
    """Émet la clé d'agent embarqué de ce robot, affichée une seule fois.

    Le serveur ne conserve que l'empreinte : personne, pas même un
    administrateur, ne peut relire la clé plus tard. La perdre coûte une
    réémission, ce qui est le bon prix ; pouvoir la relire coûterait
    l'étanchéité de toute la flotte.

    Réémettre remplace l'ancienne : un robot volé se révoque en émettant une
    nouvelle clé, sans toucher aux autres.
    """
    robot = _robot_du_perimetre(db, request, robot_id)
    cle = secrets.token_hex(24)
    robot.agent_key_hash = hashlib.sha256(cle.encode("utf-8")).hexdigest()
    robot.agent_key_issued_at = datetime.now(timezone.utc)
    db.commit()
    write_audit(db, actor=user, action="ROBOT_AGENT_KEY_ISSUE", resource=robot.nom)
    return {
        "robot": {"id": robot.id, "nom": robot.nom, "slug": robot.slug},
        "agent_key": cle,
        "issued_at": robot.agent_key_issued_at,
        "installation": {
            "fichier": "/etc/oscar/credentials/agent.key",
            "mode": "0600",
            "commande": f"sudo install -m 600 /dev/stdin /etc/oscar/credentials/agent.key <<< '{cle}'",
        },
    }


@router.get("/robots/{robot_id}/assignments")
def robot_assignments(robot_id: str, request: Request, db: Session = Depends(get_db),
                      _=Depends(require("api:robot.read"))):
    """Utilisateurs (opérateurs) associés à un robot."""
    robot = _robot_du_perimetre(db, request, robot_id)
    rows = db.execute(
        select(RobotAssignment, User).join(User, User.id == RobotAssignment.user_id)
        .where(RobotAssignment.robot_id == robot_id)
    ).all()
    return [{"user_id": u.id, "nom": u.nom, "email": u.email, "op_role": a.op_role} for a, u in rows]


@router.get("/robots/{robot_id}/integration/operator/{user_id}")
def integration_operator(robot_id: str, user_id: str, request: Request, db: Session = Depends(get_db),
                         actor=Depends(require("api:robot.integration"))):
    """Infos de connexion (opérateur) pour un utilisateur donné : à utiliser dans l'app casque/opérateur."""
    robot = _robot_du_perimetre(db, request, robot_id)
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
def integration_custom(robot_id: str, body: dict, request: Request, db: Session = Depends(get_db),
                       actor=Depends(require("api:robot.integration"))):
    """Génère les infos de connexion pour un autre équipement/client qui rejoint la room du robot."""
    robot = _robot_du_perimetre(db, request, robot_id)
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
