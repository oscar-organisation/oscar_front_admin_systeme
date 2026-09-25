# Intégration IA & Vision OSCAR

## Objectif

La perception est un service indépendant de la vidéo et du contrôle. Une panne
du modèle, du worker ou de l'overlay ne doit jamais interrompre la caméra, les
commandes LiveKit, le watchdog embarqué ou ROS 2.

## Responsabilités

Les quatre briques vivent dans trois dépôts distincts. C'est délibéré : la
perception se déploie et tombe en panne indépendamment du reste.

| Brique | Dépôt et chemin | Responsabilité |
| --- | --- | --- |
| Admin API | `oscar-admin-console/Backend/app/routers/ai.py` | Stocker les artefacts, leur SHA-256, les Model Boxes et leurs affectations |
| Admin Front | `oscar-admin-console/Admin-Console-Front-end/src/modules/module-administration/features/ai-vision/` | Importer, catégoriser, composer, publier et affecter les capacités IA |
| Perception Worker | dépôt `oscar-perception-worker` | Prendre des baux sur des robots, souscrire à leur vidéo, exécuter l'inférence et publier les résultats |
| Cockpit 2D / XR | `OSCAR/src/overlay/` | Valider et rendre les boîtes normalisées reçues par LiveKit Data |

## Objets du domaine

- Une **catégorie** est une taxonomie de recherche et de documentation. Elle ne
  contient pas de poids et n'est pas une unité de déploiement.
- Un **modèle** est une version d'artefact immuable : poids, runtime, tâche,
  dimensions d'entrée, labels, empreinte et métadonnées de validation.
- Une **Model Box** est une composition versionnée de plusieurs modèles et de
  leurs réglages d'inférence (caméra, FPS, confiance, IoU, overlay et incident).
- Une **affectation** lie une Box publiée à un robot, une flotte ou un site. En
  cas de recouvrement, la priorité est `robot > flotte > site`.

Une Box publiée est immuable. Toute évolution passe par son clonage sous une
nouvelle version, ce qui rend un déploiement reproductible et auditable.

## Cycle de vie

1. L'administrateur sélectionne une organisation et importe un artefact.
2. L'API valide le manifeste, limite la taille, calcule le SHA-256 et place le
   modèle en `sandbox`.
3. Après validation métier, le modèle est promu en `production`.
4. L'administrateur compose un ou plusieurs modèles dans une Model Box, puis
   publie cette version.
5. La Box est affectée à un robot, une flotte ou un site.
6. Un worker du pool prend un bail sur le robot, lit le manifeste résolu et
   charge ou retire les modèles sans redémarrer le publisher vidéo.
7. Pour chaque image échantillonnée, il publie un paquet
   `oscar.vision.overlay.v1` non fiable sur `oscar.vision.overlay`.
8. Le cockpit dessine les boîtes sur la vidéo 2D ou les ancre sur la surface XR.

Les anciennes affectations directes modèle-vers-robot restent lues par le
manifeste `1.1` pour compatibilité, mais elles ne font plus partie du parcours
principal de la Sandbox IA & Vision.

## Répartition de la flotte entre les workers

Un worker sert plusieurs robots, et plusieurs workers se partagent la flotte.
L'affectation passe par un bail : `POST /api/ai/runtime/workers/{worker_id}/leases`
annonce la capacité du worker et reçoit la liste des robots qu'il doit servir.
Le bail vaut 45 secondes et se renouvelle toutes les 15 ; un worker qui meurt
brutalement libère donc ses robots en moins d'une minute, et un autre les
reprend. `GET /api/ai/perception/coverage` dit qui couvre quoi, et surtout quel
robot n'est couvert par personne.

Les modèles sont chargés une fois par worker et partagés entre ses sessions.
La cadence d'inférence, elle, reste propre à chaque robot.

## Session LiveKit du worker

Le worker s'authentifie auprès de l'API avec `X-OSCAR-Worker-Key`, puis demande
`GET /api/ai/runtime/robots/{robot_id}/session` pour chacun de ses robots. Le jeton retourné permet de
s'abonner aux pistes et de publier des données, mais pas de publier une piste
audio ou vidéo. Aucun jeton longue durée n'est conservé dans l'interface.

## Contrat d'import constructeur

Un constructeur ne charge pas uniquement un fichier de poids sans contexte. Le
parcours minimal est un artefact accompagné des champs du formulaire :

- nom et version du modèle ;
- tâche (`object_detection`, `product_detection`, etc.) et runtime ;
- dimensions et espace colorimétrique d'entrée ;
- labels de sortie et catégories métier ;
- description du dataset, métriques connues et limites d'usage.

La cible est un paquet standard `.oscar-model` contenant l'artefact et un
`manifest.json` équivalent. Tant que cet import groupé n'est pas exposé, le même
contrat est saisi dans le formulaire puis stocké par l'API. Le constructeur ne
fournit jamais de script Python à exécuter sur OSCAR.

Exemple de manifeste portable :

```json
{
  "schema_version": "1.0",
  "name": "product-on-floor",
  "version": "1.0.0",
  "task": "product_detection",
  "runtime": "onnxruntime",
  "artifact": "model.onnx",
  "input": { "width": 640, "height": 640, "color_space": "RGB" },
  "labels": ["product_on_floor"],
  "metrics": { "map50": 0.9261 }
}
```

## Formats et exécution

| Format | Registre | Exécution actuelle |
| --- | --- | --- |
| Ultralytics `.pt` | Oui, artefact approuvé par un Super Admin | Oui, tâches de détection |
| ONNX `.onnx` | Oui, format recommandé pour les imports clients | Adaptateur à qualifier |
| TensorRT `.engine` | Oui | Adaptateur et cible GPU à qualifier |
| TorchScript `.torchscript` | Oui, artefact approuvé | Adaptateur à qualifier |
| TensorFlow Lite `.tflite` | Oui | Adaptateur à qualifier |

Les formats sans adaptateur peuvent être catalogués et versionnés mais ne sont
pas activables sur un robot. Cette distinction évite d'annoncer un modèle comme
opérationnel alors que son contrat de sortie n'a pas été vérifié.

## Sécurité

- Aucun script Python ou code arbitraire n'est accepté comme modèle.
- Les sérialisations PyTorch `.pt` et `.torchscript` sont réservées aux artefacts
  produits ou audités par OSCAR et validés par un Super Admin.
- Le worker vérifie le SHA-256 avant chargement, s'exécute sans privilèges, avec
  un système de fichiers en lecture seule et sans capacités Linux.
- Les coordonnées d'overlay sont normalisées entre 0 et 1 et validées côté
  worker puis côté cockpit.
- Les paquets d'overlay sont non fiables : une détection en retard est ignorée,
  jamais mise en file devant une commande opérateur.

## Démonstration

1. Déployer les migrations `0003_ai_model_runtime.py` et
   `0004_ai_model_boxes.py`, puis définir
   `PERCEPTION_WORKER_API_KEY` dans l'API.
2. Importer les poids Ultralytics fournis par l'équipe dans la Sandbox IA.
3. Promouvoir les modèles validés, créer une Box et publier sa version.
4. Affecter la Box au robot, à sa flotte ou à son site.
5. Démarrer le pool de workers avec `worker.env` construit depuis
   `worker.env.example` du dépôt `oscar-perception-worker`.
6. Ouvrir le cockpit du même robot et vérifier les paquets
   `oscar.vision.overlay.v1`.

Les exemples reçus de l'équipe IA (`product_on_floor.pt` et `dirty_floor.pt`)
restent hors des dépôts applicatifs. Ils doivent être importés par ce parcours,
comme les modèles d'un constructeur. Aucun modèle métier n'est référencé en dur
dans OSCAR. Le jeu « rayon vide » et le jeu « légumes » ne contiennent pas de
poids livrables à ce jour.
