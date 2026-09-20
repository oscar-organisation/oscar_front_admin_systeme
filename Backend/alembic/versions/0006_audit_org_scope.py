"""Rattache chaque entree du journal d'audit a une organisation.

Sans cette colonne, un administrateur borne a une organisation mais porteur de
`api:audit.read` lit le journal de toute la plateforme, y compris celui de ses
voisins. Les lignes anterieures restent a NULL : elles ne seront servies qu'aux
super administrateurs, ce qui est le choix sur.

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: Union[str, None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("org_id", sa.String(32), nullable=True))
    # Pas de cle etrangere : la trace doit survivre a la suppression de
    # l'organisation, sinon le journal perd precisement les lignes qui
    # documentent cette suppression.
    op.create_index("ix_audit_logs_org_id", "audit_logs", ["org_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_org_id", table_name="audit_logs")
    op.drop_column("audit_logs", "org_id")
