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

## Deux profils d'administrateur

Le rôle « Administrateur » et l'indicateur `is_superadmin` ne sont pas la même
chose, et la console n'expose que le premier.

| | Super administrateur | Administrateur d'organisation |
|---|---|---|
| Comment il est créé | `seed.py` uniquement : `is_superadmin` n'est dans aucun schéma d'entrée de l'API | rôle « Administrateur » + rattachement à une ou plusieurs organisations |
| Permissions | toutes les `Feature` sans calcul (`compute_permissions` court-circuite) | les mêmes, mais résolues dans l'organisation active |
| Périmètre | `accessible_organisation_ids` renvoie `None`, c'est-à-dire aucune borne | ses organisations **et leurs descendantes** (`_descendant_ids`) |
| Vue globale (`X-Organization-ID: *`) | autorisée | 403 |
| Journal d'audit | toute la plateforme | les lignes de son sous-arbre |

Un administrateur borné a donc les mêmes pouvoirs qu'un super administrateur,
appliqués à un sous-arbre. Deux mécanismes portent cette limite :

- `resolve_active_organisation_id` refuse une organisation hors périmètre, donc
  les listes filtrées par organisation active ne peuvent pas déborder ;
- `verifier_perimetre` garde chaque accès par identifiant, sinon connaître un
  identifiant suffirait à contourner le filtre des listes. Le refus est un 404
  et non un 403, pour ne pas confirmer l'existence de la ressource.

`tests/test_admin_scoping.py` démontre l'égalité des permissions et la
séparation des périmètres ; `tests/test_tenant_isolation.py` vérifie
l'étanchéité endpoint par endpoint, jetons LiveKit compris.

Un cran plus fin existe dans le modèle sans être exposé par l'interface :
`UserRole.scope_type` (`all|org|site`) permet de n'accorder un rôle que dans une
organisation donnée, via `POST /users/{id}/roles`.

## Structure
`app/{config,database,security,rbac,models,schemas,deps,seed}.py` · `app/routers/*` · `app/seed_data/*.json` · `tests/`.
Catalogue des permissions : `app/rbac.py`. Voir aussi `../ETAT-PROJET.md`.
