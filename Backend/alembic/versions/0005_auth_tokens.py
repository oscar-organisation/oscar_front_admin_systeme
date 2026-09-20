"""Single-use tokens for invitations and password resets.

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(32),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        # Empreinte SHA-256 du jeton, jamais le jeton lui-meme.
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("requested_ip", sa.String(60), nullable=True),
        sa.CheckConstraint("kind in ('invite','reset')", name="ck_auth_tokens_kind"),
    )
    op.create_index("ix_auth_tokens_user_id", "auth_tokens", ["user_id"])
    op.create_index("ix_auth_tokens_created_at", "auth_tokens", ["created_at"])
    # Unique : deux jetons ne peuvent pas partager la meme empreinte, et la
    # recherche par empreinte lors de la consommation passe par cet index.
    op.create_index("ux_auth_tokens_hash", "auth_tokens", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ux_auth_tokens_hash", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_created_at", table_name="auth_tokens")
    op.drop_index("ix_auth_tokens_user_id", table_name="auth_tokens")
    op.drop_table("auth_tokens")
