# Audit IAM multi-organisation OSCAR

Date : 2026-09-07

## État initial

Le backend possédait un RBAC fonctionnel centré sur `User`, `Role`, `Feature` et
`RolePermission`. Une seule organisation pouvait être rattachée directement à
un utilisateur. Les organisations étaient plates. Les robots pouvaient être
rattachés à une organisation, un site et des opérateurs, mais aucune notion de
flotte n'existait.

| Besoin | État initial | Incrément 0002 |
| --- | --- | --- |
| Catégories d'organisation | Absent | CRUD API et interface |
| Hiérarchie parent/enfant | Absent | Modèle, contrôle des cycles, vue arborescente |
| Accès aux descendants | Absent | Calcul du périmètre hiérarchique |
| Utilisateur multi-organisation | Une organisation | Appartenances multiples et organisation principale |
| Équipes | Absent | CRUD, membres et organisations |
| Groupes de permissions | Absent | CRUD et composition par fonctionnalités/actions |
| Groupes de rôles | Absent | CRUD, rôles et groupes de permissions |
| Attribution par équipe | Absent | Rôles et groupes de rôles hérités |
| Rôles publics/privés | Implicite via `org_id` | Visibilité explicite |
| Flottes | Absent | CRUD et rattachement des robots |
| Audit | Présent | Nouvelles actions IAM journalisées |

## Compatibilité

- `users.org_id` reste l'organisation principale pour les clients historiques.
- `user_roles` et les affectations opérateur/robot restent inchangés.
- Les permissions directes et héritées sont fusionnées au moment de
  l'autorisation.
- Les comptes super administrateurs conservent l'accès intégral.
- La migration importe automatiquement les `org_id` existants dans
  `user_organisations`.

## Suite recommandée

1. Appliquer le périmètre hiérarchique aux listes Sites, Robots, Flottes et IA.
2. Ajouter des portées organisation/site aux affectations réalisées depuis la
   page Structure IAM.
3. Déléguer l'authentification à Keycloak tout en conservant les politiques
   métier dans l'API OSCAR.
4. Ajouter une vue effective des droits expliquant leur origine : directe,
   rôle, groupe de rôles ou équipe.
