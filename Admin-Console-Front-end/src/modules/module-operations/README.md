# Module Opérations

## Responsabilité

Accès au cockpit XR et à la supervision vidéo 2D des robots affectés à l'opérateur.

## Frontières

- Les routes publiques sont déclarées dans `module.manifest.ts`.
- Les permissions cockpit et supervision appartiennent à leurs features.
- LiveKit n'est chargé qu'avec la route de supervision grâce au lazy loading.
- Les autres modules ne doivent importer que la façade `index.ts`.

## Sécurité

Les jetons LiveKit restent éphémères et sont transférés au cockpit dans le fragment URL, jamais dans la query string. L'autorisation réelle est contrôlée par l'API.
