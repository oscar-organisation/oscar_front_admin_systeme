"""Famille de chassis d'un robot, saisie et constatee.

La plateforme savait nommer un robot mais pas dire de quel materiel il
s'agissait. L'information vivait uniquement dans le fichier local du robot,
si bien que le catalogue de presets, qui range ses entrees par famille de
chassis, ne pouvait pas savoir lequel convenait a quel robot.

Deux colonnes et non une : celle que l'operateur saisit, et celle que le robot
declare. Un ecart entre les deux est une information, pas une erreur a masquer.

Revision ID: 0011
Revises: 0010
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("robots", sa.Column("modele", sa.String(length=80)))
    op.add_column("robots", sa.Column("modele_constate", sa.String(length=80)))
    op.create_index("ix_robots_modele", "robots", ["modele"])

    # Etiquette lisible pour le seul chassis physique de la flotte. La cle
    # technique n'est pas posee ici : le robot la declarera lui-meme au
    # prochain compte rendu, en lisant son propre profil embarque. La deviner
    # serait exactement l'erreur que cette separation evite.
    op.execute(
        "UPDATE robots SET modele = 'ROSMASTER M3 Pro' "
        "WHERE slug = 'oscar-02' AND modele IS NULL"
    )


def downgrade() -> None:
    op.drop_index("ix_robots_modele", table_name="robots")
    op.drop_column("robots", "modele_constate")
    op.drop_column("robots", "modele")
