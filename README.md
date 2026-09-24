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

La distribution du cockpit sous `Admin-Console-Front-end/public/xr/` est
versionnée avec la révision exacte de `oscar_front_casque_vr_ar` qui l'a
produite. Vite la copie sous `/xr/` et le Dockerfile refuse désormais de créer
une image si elle manque ou si sa base n'est pas `/xr/`. Un redéploiement de la
console ne peut donc plus effacer silencieusement l'interface XR.

Pour actualiser cette distribution depuis un clone à jour du dépôt WebXR :

```bash
Admin-Console-Front-end/scripts/update-xr-bundle.sh ../oscar_front_casque_vr_ar
```

`OSCAR_COCKPIT_URL` peut toujours viser un déploiement autonome si nécessaire.

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
