"""Catalogue des fonctionnalités (Features) protégées.

Chaque Feature est typée :
  - type="api" : une capacité backend (endpoint / scope) ; le backend l'IMPOSE (403 sinon).
  - type="ui"  : un composant / page / bouton front ; le front la MASQUE si non accordée.

Actions possibles par feature : view / create / update / delete / execute.
Ce catalogue est semé en base au démarrage et exposé via GET /features.
"""

VIEW = ["view"]
CRUD = ["view", "create", "update", "delete"]
RW = ["view", "create", "update"]
EXEC = ["view", "execute"]

# (code, label, type, module, actions)
FEATURE_CATALOG: list[tuple[str, str, str, str, list[str]]] = [
    # --- Organisations ---
    ("api:org.read", "Lire les organisations", "api", "organisations", VIEW),
    ("api:org.write", "Gérer les organisations", "api", "organisations", CRUD),
    ("ui:orgs.page", "Page Organisations", "ui", "organisations", VIEW),
    # --- Sites ---
    ("api:site.read", "Lire les sites", "api", "sites", VIEW),
    ("api:site.write", "Gérer les sites", "api", "sites", CRUD),
    ("ui:sites.page", "Page Sites", "ui", "sites", VIEW),
    # --- Utilisateurs ---
    ("api:user.read", "Lire les utilisateurs", "api", "utilisateurs", VIEW),
    ("api:user.write", "Gérer les utilisateurs", "api", "utilisateurs", CRUD),
    ("api:user.invite", "Inviter un utilisateur", "api", "utilisateurs", EXEC),
    ("ui:users.page", "Page Utilisateurs", "ui", "utilisateurs", VIEW),
    # --- Rôles & permissions ---
    ("api:role.read", "Lire les rôles", "api", "roles", VIEW),
    ("api:role.write", "Gérer les rôles et permissions", "api", "roles", CRUD),
    ("api:feature.read", "Lire le catalogue de fonctionnalités", "api", "roles", VIEW),
    ("ui:roles.page", "Page Rôles & permissions", "ui", "roles", VIEW),
    ("ui:roles.matrix", "Matrice de permissions", "ui", "roles", VIEW),
    ("api:iam.structure.read", "Lire la structure IAM", "api", "roles", VIEW),
    ("api:iam.structure.write", "Gérer la structure IAM", "api", "roles", CRUD),
    ("ui:iam.structure.page", "Page Structure IAM", "ui", "roles", VIEW),
    # --- Robots ---
    ("api:robot.read", "Lire les robots", "api", "robots", VIEW),
    ("api:robot.write", "Gérer les robots", "api", "robots", CRUD),
    ("api:robot.assign", "Associer un robot (org/site/opérateur)", "api", "robots", EXEC),
    ("api:robot.token.issue", "Émettre des jetons LiveKit", "api", "robots", EXEC),
    ("ui:robots.page", "Page Robots", "ui", "robots", VIEW),
    ("ui:robots.tokens", "Onglet Jetons LiveKit", "ui", "robots", VIEW),
    ("api:robot.integration", "Voir les détails d'intégration SDK d'un robot", "api", "robots", VIEW),
    ("ui:robots.integration", "Bouton Intégration SDK", "ui", "robots", VIEW),
    # --- Supervision (Console Opérateur) ---
    ("api:robot.supervise", "Superviser un robot associé (jeton d'accès room)", "api", "supervision", EXEC),
    ("ui:operator.page", "Espace Console Opérateur (supervision 2D)", "ui", "supervision", VIEW),
    ("ui:cockpit.page", "Cockpit XR (sélection robot et pilotage immersif)", "ui", "cockpit", VIEW),
    # --- Sandbox IA ---
    ("api:ai.model.read", "Lire les modèles IA", "api", "sandbox", VIEW),
    ("api:ai.model.upload", "Importer un modèle IA", "api", "sandbox", EXEC),
    # Retirer un modele est destructif (poids compris) : capacite distincte de
    # l'import, pour pouvoir l'accorder separement.
    ("api:ai.model.delete", "Supprimer un modèle IA", "api", "sandbox", EXEC),
    ("api:ai.model.promote", "Promouvoir / archiver un modèle", "api", "sandbox", EXEC),
    ("api:ai.model.deploy", "Activer un modèle sur un robot", "api", "sandbox", EXEC),
    ("api:ai.category.write", "Gérer les catégories de détection", "api", "sandbox", CRUD),
    ("ui:sandbox.page", "Page Sandbox IA", "ui", "sandbox", VIEW),
    ("ui:sandbox.upload_button", "Bouton Importer un modèle", "ui", "sandbox", VIEW),
    # --- Audit ---
    ("api:audit.read", "Lire le journal d'audit", "api", "audit", VIEW),
    ("ui:audit.page", "Page Audit", "ui", "audit", VIEW),
]
