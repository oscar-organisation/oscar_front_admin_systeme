# Backend - API Centrale Oscar (FastAPI)

API de la Console Admin OSCAR : organisations, sites, utilisateurs, **rôles & permissions par
fonctionnalité (`api:*` / `ui:*`)**, robots + **jetons LiveKit**, sandbox IA, audit.

## Prérequis
- Python 3.11+ · PostgreSQL (ou SQLite pour les tests/E2E).

## Configuration (aucun hardcoding - tout par env)
Copier `.env.example` → `.env` et ajuster. Variables clés : `DATABASE_URL`, `SECRET_KEY`,
`CORS_ORIGINS`, `LIVEKIT_API_KEY/SECRET/URL`, `ADMIN_EMAIL/PASSWORD`, `SEED_*`.

## Lancer (dev)
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload            # http://localhost:8000  (docs: /docs, santé: /health)
```
Au démarrage : création du schéma + **seed** (catalogue de features, admin bootstrap, données de démo
issues de `app/seed_data/*.json`). Désactiver la démo : `SEED_DEMO=false`.

## Docker
```bash
docker compose up --build      # db (Postgres) + api
```

## Tests (full - à rejouer à chaque évolution)
```bash
pip install -r requirements-dev.txt
pytest                          # 13 tests : auth, RBAC 401/403, CRUD, jetons LiveKit, sandbox, audit
```

## Comptes de démo
- Admin technique : `admin@oscar.fr` / `oscar-admin` (superadmin).
- Comptes métier (Melissa, Joel, Marc, Alice) : mot de passe = `SEED_USER_PASSWORD` (défaut `oscar-demo`).

## Structure
`app/{config,database,security,rbac,models,schemas,deps,seed}.py` · `app/routers/*` · `app/seed_data/*.json` · `tests/`.
Catalogue des permissions : `app/rbac.py`. Voir aussi `../ETAT-PROJET.md`.
