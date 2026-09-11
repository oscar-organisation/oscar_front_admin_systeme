from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from sqlalchemy.pool import StaticPool

from .config import settings


def _make_engine():
    """Cree l'engine. Cas particulier SQLite (dev/test) : robustesse thread + locks.

    En production l'URL est PostgreSQL et ce bloc n'a aucun effet. Pour SQLite
    (base de test ou dev local), on partage une connexion (StaticPool) et on
    autorise l'usage multi-thread (le serveur de test FastAPI utilise un pool de
    threads), ce qui evite les erreurs de verrou "database is locked" / "readonly".
    """
    url = settings.database_url
    if url.startswith("sqlite"):
        eng = create_engine(
            url,
            future=True,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )

        @event.listens_for(eng, "connect")
        def _set_sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover (config)
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA busy_timeout=5000")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return eng
    return create_engine(url, pool_pre_ping=True, future=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
