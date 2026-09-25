# Console d'administration OSCAR

Interface React/Vite de la plateforme. Le noyau, le routage, les manifestes de
modules, l'authentification, les permissions et la configuration sont en
TypeScript strict ; les pages de features plus anciennes restent en JSX, d'où
`allowJs`.

## Règles de contribution

1. Toute nouvelle capacité appartient à une feature rattachée à un module.
2. Toute route protégée déclare sa politique dans le manifeste de son module.
3. Toute requête passe par `shared/kernel/api`, toute erreur par le normaliseur.
4. Aucun domaine, locataire, secret ni URL d'environnement codé en dur.
5. `npm run quality` doit passer avant déploiement.
6. Toute classe visible doit être déclarée dans le bloc d'harmonisation sombre
   en même temps que sa règle de mise en forme. Une classe qui n'y figure pas
   garde son fond clair tandis que le texte suit le thème : le résultat est
   illisible, et aucun test ne le voit.

## Ce qui n'est pas encore fait

- Pas de couche i18n : les libellés sont en français dans les composants.
- L'adaptateur d'observabilité journalise dans la console ; il est prêt pour un
  collecteur distant, mais aucun n'est configuré.
- Les listes chargent tout ce que l'API renvoie. La pagination serveur devra
  venir quand les volumes réels l'exigeront.

## Commandes

```bash
npm run dev       # serveur de développement
npm test -- --run # tests unitaires et de rendu
npx tsc --noEmit  # vérification de types
npm run build     # construction de production
```
