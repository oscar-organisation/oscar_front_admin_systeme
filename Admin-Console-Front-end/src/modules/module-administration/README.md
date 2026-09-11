# Module Administration

## Responsabilité

Administration des organisations, sites, identités, habilitations, robots, modèles IA et événements d'audit.

## Frontières

- Les routes et la navigation publiques du module sont déclarées dans `module.manifest.ts`.
- Chaque feature possède son catalogue de permissions dans `feature-permissions/`.
- Les composants réutilisés uniquement dans ce domaine résident dans `shared-module/`.
- Les autres modules ne doivent importer que la façade `index.ts`.

## Sécurité

Les politiques frontend contrôlent l'affichage et l'accès aux routes. Le backend reste l'autorité et doit valider chaque opération protégée.
