"""Clé d'agent embarqué propre à chaque robot.

La reconciliation des bundles s'authentifiait avec une clé unique partagée par
toute la flotte : un robot compromis pouvait lire les déploiements de ses
voisins et rendre compte à leur place. Chaque robot porte désormais l'empreinte
de sa propre clé — la clé elle-même n'est affichée qu'une fois, à l'émission.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("robots", sa.Column("agent_key_hash", sa.String(64), nullable=True))
    op.add_column("robots", sa.Column("agent_key_issued_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("robots", "agent_key_issued_at")
    op.drop_column("robots", "agent_key_hash")
