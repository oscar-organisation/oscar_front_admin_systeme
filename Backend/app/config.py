from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    app_name: str = "Console Admin Oscar - API Centrale"
    api_prefix: str = "/api"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database (PostgreSQL)
    database_url: str = "postgresql+psycopg2://oscar:oscar@localhost:5432/oscar_admin"

    # Auth JWT
    secret_key: str = "change-me-in-prod-please-32-chars-min"
    access_ttl_minutes: int = 60
    refresh_ttl_days: int = 14

    # LiveKit (émission des jetons robot / opérateur)
    livekit_url: str = "ws://localhost:7880"           # URL cliente (navigateur) : wss://...
    livekit_host_url: str = "http://oscar-livekit-server:7880"  # API serveur (RoomService) interne
    livekit_api_key: str = "oscar_prod_key"
    livekit_api_secret: str = "oscar_super_secret_prod_key"
    livekit_robot_ttl_hours: int = 24
    livekit_operator_ttl_hours: int = 4
    livekit_sdk_ttl_hours: int = 720  # jeton SDK (intégration robot) : 30 jours par défaut

    # Bootstrap admin (seed)
    admin_email: str = "admin@oscar.fr"
    admin_password: str = "oscar-admin"
    admin_name: str = "Super Admin"

    # Seed (données de démonstration)
    seed_demo: bool = True                 # SEED_DEMO=false pour une base vierge
    seed_user_password: str = "oscar-demo"  # mot de passe des comptes de démo (jamais en dur dans le code)
    seed_data_dir: str = ""                # vide => app/seed_data (embarqué)

    # ------------------------------------------------------------------ #
    #  Courrier sortant (SMTP OVH, messagerie Zimbra).
    #  Rien n'est envoyé tant que `smtp_host` et `smtp_user` sont vides :
    #  l'API journalise alors le message au lieu de le transmettre, ce qui
    #  permet de dérouler les parcours en développement sans serveur.
    #
    #  Le serveur exact dépend de l'offre OVH souscrite, à lire dans l'espace
    #  client plutôt qu'à deviner : `ssl0.ovh.net` pour la messagerie mutualisée
    #  (MX Plan, désormais sur Zimbra), `pro#.mail.ovh.net` pour Email Pro.
    # ------------------------------------------------------------------ #
    smtp_host: str = ""                      # ex. ssl0.ovh.net
    smtp_port: int = 465                     # 465 = SSL implicite, 587 = STARTTLS
    smtp_user: str = ""                      # ex. no-reply@oscar-bot.com
    smtp_password: str = ""
    smtp_from_name: str = "OSCAR Control Plane"
    smtp_timeout_seconds: int = 15

    # Base publique de la console, utilisée pour fabriquer les liens envoyés
    # par courriel. Doit correspondre au domaine réellement servi.
    public_app_url: str = "http://localhost:5173"

    # Durées de validité des jetons à usage unique.
    invite_ttl_hours: int = 168              # 7 jours
    password_reset_ttl_minutes: int = 60

    # Garde-fous anti-abus sur les points d'entrée non authentifiés.
    password_reset_max_per_hour: int = 5

    # Stockage des modèles IA (sandbox)
    model_storage_dir: str = "./storage/models"
    model_max_upload_mb: int = 512
    perception_worker_api_key: str = ""

    # ------------------------------------------------------------------ #
    #  Keycloak / OIDC (IAM) - piloté par variables d'environnement.
    #  En Lot 0 rien n'est activé par défaut (auth_mode="legacy") afin de
    #  ne rien casser : ces réglages servent au provisioning et au module
    #  de validation JWKS (additif, testable sans Keycloak réel).
    # ------------------------------------------------------------------ #
    # Mode d'authentification effectif : "legacy" (JWT HS256 maison, défaut)
    # ou "keycloak" (validation des access tokens RS256 via JWKS). Le cutover
    # vers "keycloak" se fera dans un lot ultérieur.
    auth_mode: str = "legacy"

    # Émetteur (issuer) attendu dans les tokens : realm Keycloak.
    oidc_issuer: str = "http://localhost:8080/realms/oscar"
    # Audience attendue (client backend). Un token est accepté si son claim
    # `aud` OU `azp` correspond à cette valeur.
    oidc_audience: str = "oscar-backend"
    # URL des clés publiques (JWKS). Si vide, dérivée de l'issuer :
    # {issuer}/protocol/openid-connect/certs (voir propriété oidc_jwks_url_effective).
    oidc_jwks_url: str = ""

    # Base Keycloak (Admin REST API) et realm cible.
    keycloak_base_url: str = "http://localhost:8080"
    keycloak_realm: str = "oscar"
    # Compte d'administration Keycloak utilisé par le provisioning (sync_realm.py).
    keycloak_admin_user: str = "admin"
    keycloak_admin_password: str = "admin"
    # Client confidentiel backend (audience / service account) et son secret.
    # Le secret n'a JAMAIS de valeur exploitable en dur : à fournir par env en prod.
    keycloak_backend_client_id: str = "oscar-backend"
    keycloak_backend_client_secret: str = ""

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def oidc_jwks_url_effective(self) -> str:
        """URL JWKS effective : explicite si fournie, sinon dérivée de l'issuer."""
        if self.oidc_jwks_url:
            return self.oidc_jwks_url
        return f"{self.oidc_issuer.rstrip('/')}/protocol/openid-connect/certs"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
