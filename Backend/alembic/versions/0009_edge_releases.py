"""Paquets embarqués distribuables et canal de mise à jour par robot.

La console distribuait de la configuration, pas du code : installer une version
du paquet embarqué demandait encore une copie manuelle sur chaque robot. Cette
table porte les archives et leur empreinte ; `robots.edge_channel` permet de
faire passer un robot témoin avant la flotte.

Revision ID: 0009
Revises: 0008
Create Date: 2026-09-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "edge_releases",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("canal", sa.String(20), nullable=False, server_default="stable"),
        sa.Column("statut", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("fichier", sa.String(512), nullable=False),
        sa.Column("archive_nom", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("taille", sa.Integer(), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("published_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_by", sa.String(32), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("version", name="uq_edge_release_version"),
    )
    op.add_column("robots", sa.Column("edge_channel", sa.String(20), nullable=False,
                                      server_default="stable"))
    op.add_column("robots", sa.Column("edge_version", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("robots", "edge_version")
    op.drop_column("robots", "edge_channel")
    op.drop_table("edge_releases")
