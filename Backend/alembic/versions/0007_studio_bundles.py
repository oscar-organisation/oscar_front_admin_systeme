"""Bundles de déploiement du Studio, leurs versions et leurs déploiements.

Le Studio composait jusqu'ici dans le navigateur. Ces tables donnent au plan une
existence serveur : une identité stable (le bundle), des versions figées à la
publication, et un fait daté par robot pour chaque déploiement demandé.

La colonne `robots.slug` réconcilie les deux identités du robot : l'UUID interne
de la console et l'identifiant lisible que l'agent embarqué porte dans son
enrôlement (`^[a-z0-9][a-z0-9-]{2,62}$`).

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-20
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slug(valeur: str, defaut: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (valeur or "").lower()).strip("-")
    base = base[:62] or defaut
    if len(base) < 3:
        base = f"{base}-robot"[:62]
    return base


def upgrade() -> None:
    op.add_column("robots", sa.Column("slug", sa.String(64), nullable=True))
    op.create_index("ix_robots_slug", "robots", ["slug"], unique=True)

    # Rattrapage des robots existants : sans slug, ils resteraient invisibles
    # pour l'agent embarque, qui ne connait pas les UUID.
    connexion = op.get_bind()
    lignes = connexion.execute(sa.text("SELECT id, nom FROM robots")).fetchall()
    pris: set[str] = set()
    for robot_id, nom in lignes:
        candidat = _slug(nom, f"robot-{robot_id[:6]}")
        suffixe = 2
        while candidat in pris:
            candidat = f"{_slug(nom, 'robot')[:58]}-{suffixe}"
            suffixe += 1
        pris.add(candidat)
        connexion.execute(
            sa.text("UPDATE robots SET slug = :slug WHERE id = :id"),
            {"slug": candidat, "id": robot_id},
        )

    op.create_table(
        "deployment_bundles",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(160), nullable=False),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("target", sa.String(60), nullable=False, server_default="ENVIRONNEMENT_EXECUTION_ROBOT"),
        sa.Column("statut", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("org_id", "slug", name="uq_deployment_bundle_org_slug"),
    )

    op.create_table(
        "bundle_versions",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("bundle_id", sa.String(32), sa.ForeignKey("deployment_bundles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("numero", sa.Integer(), nullable=False),
        sa.Column("statut", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("spec", sa.JSON(), nullable=False),
        sa.Column("checksum", sa.String(64)),
        sa.Column("notes", sa.Text()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("published_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("bundle_id", "numero", name="uq_bundle_version_numero"),
    )

    op.create_table(
        "bundle_deployments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", sa.String(32), sa.ForeignKey("bundle_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("statut", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.Column("message", sa.Text()),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_bundle_deployments_robot_id", "bundle_deployments", ["robot_id"])
    op.create_index("ix_bundle_deployments_statut", "bundle_deployments", ["statut"])


def downgrade() -> None:
    op.drop_index("ix_bundle_deployments_statut", table_name="bundle_deployments")
    op.drop_index("ix_bundle_deployments_robot_id", table_name="bundle_deployments")
    op.drop_table("bundle_deployments")
    op.drop_table("bundle_versions")
    op.drop_table("deployment_bundles")
    op.drop_index("ix_robots_slug", table_name="robots")
    op.drop_column("robots", "slug")
