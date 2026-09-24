"""Registre des baux de perception.

Un worker de perception servait un seul robot, fige dans sa configuration. Pour
qu'un worker en serve plusieurs et que la flotte se repartisse entre workers,
il faut un endroit ou s'inscrit qui s'occupe de qui.

Le bail sert aussi de preuve de vie. Sans lui, un worker qui meurt laisse ses
robots sans perception et personne ne l'apprend.

Revision ID: 0012
Revises: 0011
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "perception_leases",
        # Cle primaire sur le robot : deux workers ne peuvent pas se croire
        # responsables du meme robot, et c'est la base qui l'interdit.
        sa.Column("robot_id", sa.String(length=32),
                  sa.ForeignKey("robots.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("worker_id", sa.String(length=64), nullable=False),
        sa.Column("acquired_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("renewed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_perception_leases_worker_id", "perception_leases", ["worker_id"])
    op.create_index("ix_perception_leases_expires_at", "perception_leases", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_perception_leases_expires_at", table_name="perception_leases")
    op.drop_index("ix_perception_leases_worker_id", table_name="perception_leases")
    op.drop_table("perception_leases")
