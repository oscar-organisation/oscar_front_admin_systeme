# Audit Frontend Enterprise

Référence : spécification `frontend-react-vite-enterprise-saas-modular-permission-driven` version 1.1.0.

## Résultat

Le frontend dispose désormais d'un noyau React/Vite strict, d'un registre de modules, de politiques d'accès centralisées, d'une configuration runtime et d'une gestion normalisée des erreurs. Le design industriel cyan antérieur a été conservé et corrigé au lieu d'imposer la refonte Graphite rejetée.

## Corrigé

- Registre de modules avec routes lazy, navigation issue des manifests et validation des identifiants.
- Permissions propriétaires par module et feature, guards de routes, pages 403 et 404.
- Client API central avec timeout, annulation, identifiant de requête, scope tenant/organisation et refresh single-flight.
- Configuration publique injectée au runtime, branding et thème clair/sombre/système.
- Error Boundary global, normalisation des erreurs et point unique d'observabilité.
- Suppression des `catch` vides et des erreurs backend brutes sur les parcours principaux.
- Sidebar repliable, sélection lisible et page rôles bornée avec recherche et scroll local.
- Gestion complète des utilisateurs conservée : identité, email, organisation, statut, mot de passe, rôles et suppression.
- Headers de sécurité, image Nginx non-root, cache des assets et pages privées `noindex`.
- Tests unitaires du noyau, tests de rendu et scénarios navigateur desktop/mobile.

## Dérogations temporaires

- Les pages de features historiques restent en JSX avec `allowJs: true`; le noyau, le routage, les manifests, l'authentification, les permissions et la configuration sont en TypeScript strict. Migration recommandée feature par feature afin de ne pas risquer les workflows métier existants.
- Le catalogue de textes reste en français dans les composants. Une couche i18n doit précéder l'ouverture multi-langue.
- L'adaptateur d'observabilité journalise des événements structurés dans la console. Il est prêt pour Sentry ou OpenTelemetry, mais aucun collecteur distant n'est configuré.
- Les listes utilisent encore le chargement complet fourni par l'API. La pagination serveur doit être ajoutée lorsque les volumes réels le nécessitent.

## Règles de contribution

1. Toute nouvelle capacité appartient à une feature rattachée à un module.
2. Toute route protégée déclare une politique dans son manifest.
3. Toute requête passe par `shared/kernel/api` et toute erreur par le normaliseur.
4. Aucun domaine, tenant, secret ou URL d'environnement ne doit être codé en dur.
5. `npm run quality` doit passer avant déploiement.
