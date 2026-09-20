from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, SessionLocal, engine
from .routers import api_router
from .seed import run_seed


def init_db() -> None:
    # Dev : création directe du schéma. En prod : Alembic (voir alembic/).
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        run_seed(db)
    finally:
        db.close()


def _verifier_configuration_courriel() -> None:
    """Refuse de démarrer avec un SMTP actif et une URL publique de développement.

    Le défaut de `public_app_url` vise le poste de développement. S'il reste en
    place alors que le courrier part réellement, l'API fabrique des liens
    d'invitation vers `localhost` : le destinataire reçoit un message
    parfaitement inutilisable, et rien ne le signale.

    Le garde-fou se déclenche sur la conjonction des deux, et seulement sur
    elle : en développement le SMTP est vide et rien ne bloque, en production
    le courrier est configuré et l'URL doit donc l'être aussi.
    """
    from .mailer import smtp_configure

    if not smtp_configure():
        return
    hote = urlparse(settings.public_app_url).hostname or ""
    if hote in {"localhost", "127.0.0.1", "::1", ""}:
        raise RuntimeError(
            "SMTP est configuré mais PUBLIC_APP_URL vaut "
            f"{settings.public_app_url!r}. Les liens envoyés par courriel "
            "seraient inutilisables. Renseignez le domaine réellement servi."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _verifier_configuration_courriel()
    init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/health")
def health():
    return {"status": "ok", "service": settings.app_name}
