"""Dernier contact de l'agent embarque, et archivage des projets.

Deux trous du meme genre : un etat affiche qui ne correspondait a rien.

La pastille de presence lisait `robots.statut`, une colonne ecrite une fois a
la creation du robot et jamais ensuite. Tous les robots etaient donc « online »
en permanence, dans la console comme dans le cockpit XR. On ajoute la seule
donnee qui manquait, le dernier contact, et la presence se deduit a la lecture.

`deployment_bundles.statut` acceptait deja « archived » et le refus de
suppression renvoyait « archivez-le au lieu de le supprimer », mais aucune
route ni aucun bouton ne permettait de le faire. Rien a migrer pour celui-la :
la colonne existe, il lui manquait un chemin.

Revision ID: 0013
Revises: 0012
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("robots", sa.Column("vu_le", sa.DateTime(timezone=True), nullable=True))
    # Aucune valeur de depart : un robot qu'on n'a jamais vu doit s'afficher
    # hors ligne, pas en ligne par defaut. C'est precisement le mensonge qu'on
    # corrige ici.


def downgrade() -> None:
    op.drop_column("robots", "vu_le")
