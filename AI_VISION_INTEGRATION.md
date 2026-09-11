# Intégration IA & Vision OSCAR

## Objectif

La perception est un service indépendant de la vidéo et du contrôle. Une panne
du modèle, du worker ou de l'overlay ne doit jamais interrompre la caméra, les
commandes LiveKit, le watchdog embarqué ou ROS 2.

## Responsabilités

| Brique | Responsabilité |
| --- | --- |
| Admin API | Stocker le manifeste, l'artefact, son SHA-256 et les activations par robot |
| Admin Front | Importer, promouvoir et activer un modèle dans le contexte d'une organisation |
| Perception Worker | Souscrire à la vidéo, exécuter l'inférence et publier les résultats |
| Cockpit 2D / XR | Valider et rendre les boîtes normalisées reçues par LiveKit Data |

## Cycle de vie

1. L'administrateur sélectionne une organisation et importe un artefact.
2. L'API valide le manifeste, limite la taille, calcule le SHA-256 et place le
   modèle en `sandbox`.
3. Après validation métier, le modèle est promu en `production`.
4. L'administrateur l'active pour un robot, avec une cadence et des seuils.
5. Le worker lit le manifeste toutes les dix secondes et charge ou retire les
   modèles sans redémarrer le publisher vidéo.
6. Pour chaque image échantillonnée, il publie un paquet
   `oscar.vision.overlay.v1` non fiable sur `oscar.vision.overlay`.
7. Le cockpit dessine les boîtes sur la vidéo 2D ou les ancre sur la surface XR.

## Session LiveKit du worker

Le worker s'authentifie auprès de l'API avec `X-OSCAR-Worker-Key`, puis demande
`GET /api/ai/runtime/robots/{robot_id}/session`. Le jeton retourné permet de
s'abonner aux pistes et de publier des données, mais pas de publier une piste
audio ou vidéo. Aucun jeton longue durée n'est conservé dans l'interface.

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

1. Déployer la migration `0003_ai_model_runtime.py` et définir
   `PERCEPTION_WORKER_API_KEY` dans l'API.
2. Importer les poids Ultralytics fournis par l'équipe dans la Sandbox IA.
3. Promouvoir le modèle, sélectionner le robot et activer l'inférence à 5 FPS.
4. Démarrer un worker avec `worker.env` construit depuis
   `services/perception-worker/worker.env.example`.
5. Ouvrir le cockpit du même robot et vérifier les paquets
   `oscar.vision.overlay.v1`.

Les deux guides de l'équipe citent `product_on_floor.pt`, `dirty_floor.pt` et
`empty_shelf.pt`. Ces poids ne sont pas présents dans la base de code actuelle :
ils doivent être fournis séparément avant le test d'inférence de bout en bout.
