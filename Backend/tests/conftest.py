import os
import pathlib
import tempfile

import pytest

HERE = pathlib.Path(__file__).parent
# Base de test UNIQUE par processus pytest (isolation stricte). Evite toute
# collision quand un second pytest tourne en parallele sur la meme machine : sur
# un fichier SQLite partage, la recreation du fichier sous une connexion ouverte
# provoque SQLITE_READONLY_DBMOVED ("attempt to write a readonly database").
TEST_DB = pathlib.Path(tempfile.gettempdir()) / f"oscar_admin_test_{os.getpid()}.db"

# Environnement de test defini au niveau MODULE (conftest importe par pytest
# avant la collecte des modules de test). Cela garantit que DATABASE_URL et les
# secrets sont en place AVANT tout import de `app.*` au sommet d'un module de
# test (ex tests/test_keycloak_auth.py), donc avant la mise en cache de
# `app.config.settings` et la creation de l'engine SQLAlchemy.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{TEST_DB}")
os.environ.setdefault("SECRET_KEY", "test-secret-key-abcdefghijklmnopqrstuvwxyz-012345")
os.environ.setdefault("ADMIN_EMAIL", "admin@oscar.fr")
os.environ.setdefault("ADMIN_PASSWORD", "oscar-admin")
os.environ.setdefault("LIVEKIT_API_KEY", "oscar_prod_key")
os.environ.setdefault("LIVEKIT_API_SECRET", "oscar_super_secret_prod_key")
os.environ.setdefault("MODEL_STORAGE_DIR", str(HERE / "_storage"))
os.environ.setdefault("PERCEPTION_WORKER_API_KEY", "test-perception-worker-key")
os.environ.setdefault("EDGE_AGENT_API_KEY", "test-edge-agent-key")
os.environ.setdefault("EDGE_RELEASE_DIR", str(HERE / "_releases"))


def _purge_stockage():
    # Les archives de paquets survivent au fichier de base : sans purge, une
    # session heritait des versions de la precedente et refusait de les
    # reimporter.
    import shutil

    shutil.rmtree(HERE / "_releases", ignore_errors=True)


def _purge_test_db():
    # Supprime le fichier SQLite de test et ses annexes (journal/WAL/SHM).
    for suffix in ("", "-journal", "-wal", "-shm"):
        p = pathlib.Path(str(TEST_DB) + suffix)
        if p.exists():
            p.unlink()


@pytest.fixture(scope="session", autouse=True)
def _env():
    # Base de test repartie de zero a chaque session (idempotence des tests).
    _purge_test_db()
    _purge_stockage()
    yield
    _purge_test_db()
    _purge_stockage()


@pytest.fixture(scope="session")
def client(_env):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin_headers(client):
    r = client.post("/api/auth/login", json={"email": "admin@oscar.fr", "password": "oscar-admin"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
