"""Courrier sortant de la console OSCAR (SMTP OVH).

Un seul point de sortie pour tout ce que la plateforme envoie : invitation,
réinitialisation de mot de passe, confirmation de changement. Les gabarits sont
ici plutôt que dans les routeurs, afin qu'un même message ne soit pas réécrit à
trois endroits.

Deux principes tenus par ce module :

- **L'envoi ne fait jamais échouer l'appel métier.** Une invitation créée puis
  un SMTP indisponible ne doit pas laisser un utilisateur à moitié créé. Les
  erreurs sont journalisées et la fonction retourne `False`.
- **Sans configuration, rien ne part.** Si `smtp_host` ou `smtp_user` est vide,
  le message est écrit dans le journal au niveau INFO. Les parcours se
  déroulent donc entièrement en développement, et le jour où les identifiants
  OVH sont renseignés, le même code envoie réellement.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr

from .config import settings

log = logging.getLogger("oscar.mailer")


@dataclass
class Courriel:
    destinataire: str
    sujet: str
    texte: str
    html: str


# --------------------------------------------------------------------------- #
#  Gabarits
# --------------------------------------------------------------------------- #

_BASE_HTML = """\
<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#f4f4f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f4f4f6;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:520px;background:#ffffff;border-radius:10px;
                      border:1px solid #e4e4e8;padding:32px;
                      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
          <tr><td style="padding-bottom:24px;">
            <span style="font-size:13px;font-weight:700;letter-spacing:.12em;
                         text-transform:uppercase;color:#c94e0b;">OSCAR</span>
            <span style="font-size:13px;color:#8a9199;">&nbsp;·&nbsp;Control Plane</span>
          </td></tr>
          <tr><td style="font-size:19px;font-weight:600;color:#15171a;padding-bottom:14px;">
            {titre}
          </td></tr>
          <tr><td style="font-size:14px;line-height:1.6;color:#42464b;padding-bottom:26px;">
            {corps}
          </td></tr>
          {bouton}
          <tr><td style="font-size:12px;line-height:1.6;color:#8a9199;
                         border-top:1px solid #ececf0;padding-top:20px;">
            {pied}
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>
"""

_BOUTON_HTML = """\
<tr><td style="padding-bottom:26px;">
  <a href="{lien}" style="display:inline-block;padding:12px 22px;border-radius:7px;
     background:#c94e0b;color:#ffffff;font-size:14px;font-weight:600;
     text-decoration:none;">{libelle}</a>
</td></tr>
<tr><td style="font-size:12px;line-height:1.6;color:#8a9199;padding-bottom:22px;">
  Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :<br>
  <span style="color:#42464b;word-break:break-all;">{lien}</span>
</td></tr>
"""


def _rendre(titre: str, corps: str, pied: str, lien: str = "", libelle: str = "") -> str:
    bouton = _BOUTON_HTML.format(lien=lien, libelle=libelle) if lien else ""
    return _BASE_HTML.format(titre=titre, corps=corps, bouton=bouton, pied=pied)


def courriel_invitation(nom: str, lien: str, ttl_heures: int) -> Courriel:
    jours = max(1, ttl_heures // 24)
    corps = (
        f"Bonjour {nom},<br><br>"
        "Un accès à la console d'administration OSCAR vient d'être ouvert à votre nom. "
        "Choisissez votre mot de passe pour activer le compte."
    )
    pied = (
        f"Ce lien est valable {jours} jour{'s' if jours > 1 else ''} et ne peut servir qu'une fois. "
        "Si vous n'attendiez pas cette invitation, ignorez ce message : le compte restera inactif."
    )
    texte = (
        f"Bonjour {nom},\n\n"
        "Un acces a la console d'administration OSCAR vient d'etre ouvert a votre nom.\n"
        f"Choisissez votre mot de passe ici : {lien}\n\n"
        f"Ce lien est valable {jours} jour(s) et ne peut servir qu'une fois.\n"
        "Si vous n'attendiez pas cette invitation, ignorez ce message."
    )
    return Courriel(
        destinataire="",
        sujet="Votre accès à la console OSCAR",
        texte=texte,
        html=_rendre("Activez votre accès", corps, pied, lien, "Choisir mon mot de passe"),
    )


def courriel_reinitialisation(nom: str, lien: str, ttl_minutes: int) -> Courriel:
    corps = (
        f"Bonjour {nom},<br><br>"
        "Une réinitialisation de mot de passe a été demandée pour ce compte. "
        "Si vous en êtes à l'origine, choisissez un nouveau mot de passe."
    )
    pied = (
        f"Ce lien expire dans {ttl_minutes} minutes et ne peut servir qu'une fois. "
        "Si vous n'avez rien demandé, aucune action n'est nécessaire : votre mot de passe "
        "actuel reste valable."
    )
    texte = (
        f"Bonjour {nom},\n\n"
        "Une reinitialisation de mot de passe a ete demandee pour ce compte.\n"
        f"Choisissez un nouveau mot de passe ici : {lien}\n\n"
        f"Ce lien expire dans {ttl_minutes} minutes et ne peut servir qu'une fois.\n"
        "Si vous n'avez rien demande, aucune action n'est necessaire."
    )
    return Courriel(
        destinataire="",
        sujet="Réinitialisation de votre mot de passe OSCAR",
        texte=texte,
        html=_rendre("Réinitialiser le mot de passe", corps, pied, lien, "Choisir un nouveau mot de passe"),
    )


def courriel_mot_de_passe_change(nom: str) -> Courriel:
    """Notification après coup : c'est ce qui permet de détecter un accès illégitime."""
    corps = (
        f"Bonjour {nom},<br><br>"
        "Le mot de passe de votre compte OSCAR vient d'être modifié."
    )
    pied = (
        "Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement "
        "l'administrateur de votre organisation : votre compte est peut-être compromis."
    )
    texte = (
        f"Bonjour {nom},\n\n"
        "Le mot de passe de votre compte OSCAR vient d'etre modifie.\n\n"
        "Si vous n'etes pas a l'origine de ce changement, contactez immediatement "
        "l'administrateur de votre organisation."
    )
    return Courriel(
        destinataire="",
        sujet="Votre mot de passe OSCAR a été modifié",
        texte=texte,
        html=_rendre("Mot de passe modifié", corps, pied),
    )


# --------------------------------------------------------------------------- #
#  Transport
# --------------------------------------------------------------------------- #

def smtp_configure() -> bool:
    return bool(settings.smtp_host and settings.smtp_user)


def envoyer(courriel: Courriel, destinataire: str) -> bool:
    """Transmet le message. Retourne False sur échec, sans jamais lever."""
    message = EmailMessage()
    message["Subject"] = courriel.sujet
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_user or "no-reply@localhost"))
    message["To"] = destinataire
    message.set_content(courriel.texte)
    message.add_alternative(courriel.html, subtype="html")

    if not smtp_configure():
        log.info(
            "SMTP non configure : message non transmis.\n"
            "  destinataire : %s\n  sujet : %s\n  corps texte :\n%s",
            destinataire, courriel.sujet, courriel.texte,
        )
        return False

    try:
        contexte = ssl.create_default_context()
        if settings.smtp_port == 465:
            with smtplib.SMTP_SSL(
                settings.smtp_host, settings.smtp_port,
                timeout=settings.smtp_timeout_seconds, context=contexte,
            ) as serveur:
                serveur.login(settings.smtp_user, settings.smtp_password)
                serveur.send_message(message)
        else:
            with smtplib.SMTP(
                settings.smtp_host, settings.smtp_port,
                timeout=settings.smtp_timeout_seconds,
            ) as serveur:
                serveur.starttls(context=contexte)
                serveur.login(settings.smtp_user, settings.smtp_password)
                serveur.send_message(message)
        log.info("Courriel transmis a %s (%s)", destinataire, courriel.sujet)
        return True
    except Exception:
        # Un envoi rate ne doit jamais annuler l'operation metier qui l'a declenche.
        log.exception("Echec d'envoi a %s (%s)", destinataire, courriel.sujet)
        return False
