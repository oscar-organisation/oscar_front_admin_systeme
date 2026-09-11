# OSCAR Control Plane

Monorepo de la plateforme d'administration OSCAR. Il contient l'interface de
gestion multi-organisation et l'API centrale qui porte l'IAM, les flottes, les
sites, les utilisateurs et la création des sessions LiveKit.

## Composants

- `Admin-Console-Front-end/` : React, Vite, TypeScript, cockpit 2D et lanceur XR.
- `Backend/` : FastAPI, PostgreSQL, Alembic, RBAC et intégration LiveKit.

Le transport temps réel et le runtime embarqué vivent dans
`oscar-organisation/oscar_Backend_gateway`. Le client WebXR vit dans
`oscar-organisation/oscar_front_casque_vr_ar`.

Le contenu généré de `Admin-Console-Front-end/public/xr/` n'est pas versionné.
Le pipeline de livraison doit y déposer un build du dépôt WebXR ou configurer
`OSCAR_COCKPIT_URL` vers son déploiement autonome.

## Validation

```bash
cd Admin-Console-Front-end
npm ci
npm run quality
npm run test:e2e

cd ../Backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
PYTHONPATH=. pytest -q
```

## Configuration

Les secrets ne sont jamais versionnés. Utiliser les fichiers
`.env.example`/`.env.deploy.example`, puis injecter les valeurs de production
depuis le gestionnaire de secrets ou les fichiers protégés du serveur.
