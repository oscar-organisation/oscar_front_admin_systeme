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
from .. import auth_tokens, mailer
from ..config import settings
from ..models import AuthToken, Organisation, User
from ..schemas import (
    ForgotPasswordIn,
    InvitationCheckOut,
    PasswordPolicyOut,
    LoginIn,
    MeOut,
    OrganisationContextOut,
    PasswordChangeIn,
    ProfileUpdateIn,
    ResetPasswordIn,
    TokenOut,
)
from ..security import create_access_token, decode_token, hash_password, verify_password

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


# --------------------------------------------------------------------------- #
#  Mot de passe oublié, réinitialisation, activation d'invitation
#
#  Ces trois points d'entrée sont les seuls de l'API accessibles sans jeton.
#  Ils appliquent donc trois règles strictes :
#
#  1. Aucune divulgation. `/forgot-password` répond toujours 204, qu'un compte
#     existe ou non. Sinon l'API devient un outil d'énumération d'adresses.
#  2. Aucune connexion implicite. Consommer un jeton ne connecte pas : il faut
#     ensuite passer par `/login`, ce qui laisse une trace d'audit normale.
#  3. Le jeton est brûlé avant toute écriture du mot de passe, et un rejeu
#     échoue même si l'utilisateur recharge la page.
# --------------------------------------------------------------------------- #

def _politique_mot_de_passe(brut: str) -> None:
    """Longueur minimale seule, conformément aux recommandations actuelles.

    Imposer des classes de caractères produit des mots de passe plus courts et
    plus prévisibles ; la longueur est le seul critère qui résiste vraiment.
    """
    if len(brut) < settings.password_min_length:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Le mot de passe doit contenir au moins {settings.password_min_length} caractères.",
        )
    if len(brut) > 200:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Mot de passe trop long.")


@router.get("/password-policy", response_model=PasswordPolicyOut)
def password_policy():
    """Politique de mot de passe appliquee par l'API.

    Expose pour que l'interface affiche exactement la regle qui sera imposee,
    plutot que d'en garder une copie qui diverge au premier changement.
    """
    return PasswordPolicyOut(min_length=settings.password_min_length)


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(body: ForgotPasswordIn, request: Request, db: Session = Depends(get_db)):
    """Envoie un lien de réinitialisation. Répond 204 quoi qu'il arrive."""
    ip = request.client.host if request.client else None
    user = db.execute(
        select(User).where(User.email == body.email.strip().lower())
    ).scalar_one_or_none()

    # Compte inconnu ou desactive : on s'arrete, mais la reponse reste identique.
    if user and user.statut != "disabled":
        if auth_tokens.trop_de_demandes(db, user):
            write_audit(db, actor=None, action="PASSWORD_RESET_THROTTLED",
                        resource=user.email, result="denied", ip=ip)
            db.commit()
        else:
            secret = auth_tokens.emettre(db, user, auth_tokens.RESET, ip)
            write_audit(db, actor=None, action="PASSWORD_RESET_REQUESTED",
                        resource=user.email, ip=ip)
            db.commit()
            mailer.envoyer(
                mailer.courriel_reinitialisation(
                    user.nom,
                    auth_tokens.lien("/reset-password", secret),
                    settings.password_reset_ttl_minutes,
                ),
                user.email,
            )
    else:
        write_audit(db, actor=None, action="PASSWORD_RESET_UNKNOWN",
                    resource=body.email, result="denied", ip=ip)
        db.commit()
    return None


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    _politique_mot_de_passe(body.password)

    user = auth_tokens.consommer(db, body.token, auth_tokens.RESET)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lien invalide ou expiré.")

    user.password_hash = hash_password(body.password)
    if user.statut == "invited":
        user.statut = "active"
    write_audit(db, actor=user, action="PASSWORD_RESET", resource=user.email, ip=ip)
    db.commit()
    mailer.envoyer(mailer.courriel_mot_de_passe_change(user.nom), user.email)
    return None


@router.post("/accept-invitation", status_code=status.HTTP_204_NO_CONTENT)
def accept_invitation(body: ResetPasswordIn, request: Request, db: Session = Depends(get_db)):
    """Activation d'un compte invité : le mot de passe est choisi ici."""
    ip = request.client.host if request.client else None
    _politique_mot_de_passe(body.password)

    user = auth_tokens.consommer(db, body.token, auth_tokens.INVITE)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invitation invalide ou expirée.")

    user.password_hash = hash_password(body.password)
    user.statut = "active"
    write_audit(db, actor=user, action="INVITATION_ACCEPTED", resource=user.email, ip=ip)
    db.commit()
    return None


@router.get("/invitation/{token}", response_model=InvitationCheckOut)
def check_invitation(token: str, db: Session = Depends(get_db)):
    """Vérifie un lien avant d'afficher le formulaire, sans le consommer.

    Permet d'annoncer « lien expiré » sur la page plutôt qu'après la saisie.
    Ne révèle que le nom et l'adresse déjà connus du porteur du lien.
    """
    empreinte = auth_tokens._empreinte(token)
    ligne = db.execute(
        select(AuthToken).where(AuthToken.token_hash == empreinte)
    ).scalar_one_or_none()
    if ligne is None or ligne.used_at is not None:
        return InvitationCheckOut(valide=False)
    expire = ligne.expires_at
    if expire.tzinfo is None:
        expire = expire.replace(tzinfo=timezone.utc)
    if expire < datetime.now(timezone.utc):
        return InvitationCheckOut(valide=False)
    user = db.get(User, ligne.user_id)
    if user is None:
        return InvitationCheckOut(valide=False)
    return InvitationCheckOut(valide=True, email=user.email, nom=user.nom, kind=ligne.kind)


# --------------------------------------------------------------------------- #
#  Compte personnel
#
#  Distinct de `/users/{id}` : ces routes n'exigent aucune permission
#  d'administration, seulement d'être authentifié, et n'agissent que sur le
#  porteur du jeton. Un opérateur sans droit sur la gestion des utilisateurs
#  peut donc corriger son nom et changer son mot de passe.
# --------------------------------------------------------------------------- #

@router.patch("/me/profile", response_model=MeOut)
def update_my_profile(
    body: ProfileUpdateIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.nom is not None:
        nom = body.nom.strip()
        if not nom:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Le nom ne peut pas être vide.")
        user.nom = nom

    if body.email is not None:
        email = body.email.strip().lower()
        if email != user.email:
            existe = db.execute(
                select(User).where(User.email == email, User.id != user.id)
            ).scalar_one_or_none()
            if existe:
                raise HTTPException(status.HTTP_409_CONFLICT, "Cette adresse est déjà utilisée.")
            user.email = email

    write_audit(db, actor=user, action="PROFILE_UPDATE", resource=user.email,
                ip=request.client.host if request.client else None)
    db.commit()
    return me(request, user, db)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_my_password(
    body: PasswordChangeIn,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else None

    # Le mot de passe courant est exige meme si la session est valide : sans
    # cela, un poste laisse ouvert suffit a verrouiller le compte de son
    # proprietaire.
    if not user.password_hash or not verify_password(body.current_password, user.password_hash):
        write_audit(db, actor=user, action="PASSWORD_CHANGE_DENIED",
                    resource=user.email, result="denied", ip=ip)
        db.commit()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Mot de passe actuel incorrect.")

    _politique_mot_de_passe(body.new_password)
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Le nouveau mot de passe doit être différent de l'actuel.",
        )

    user.password_hash = hash_password(body.new_password)
    write_audit(db, actor=user, action="PASSWORD_CHANGE", resource=user.email, ip=ip)
    db.commit()
    mailer.envoyer(mailer.courriel_mot_de_passe_change(user.nom), user.email)
    return None
