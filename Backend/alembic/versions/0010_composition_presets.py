"""Catalogue de compositions de reference livre par la plateforme.

Les presets ne portent pas d'org_id : ils sont les memes pour tous les
clients. C'est voulu, et c'est la difference avec un bundle, qui appartient a
une organisation.

Revision ID: 0010
Revises: 0009
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "composition_presets",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("slug", sa.String(length=80), nullable=False, unique=True),
        sa.Column("nom", sa.String(length=160), nullable=False),
        sa.Column("constructeur", sa.String(length=80)),
        sa.Column("famille", sa.String(length=80), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("spec", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("statut", sa.String(length=20), nullable=False, server_default="draft"),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by", sa.String(length=32),
                  sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_composition_presets_famille", "composition_presets", ["famille"])


def downgrade() -> None:
    op.drop_index("ix_composition_presets_famille", table_name="composition_presets")
    op.drop_table("composition_presets")
