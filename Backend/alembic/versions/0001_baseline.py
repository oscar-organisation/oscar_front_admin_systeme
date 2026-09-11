"""baseline - schema courant (Lot 0).

Migration baseline autogeneree depuis app.models (schema ACTUEL de l'app).
Objectif Lot 0 : `alembic upgrade head` sur une base vierge produit le schema
courant, a l'identique de create_all. create_all reste actif dans app/main.py ;
le cutover create_all -> alembic se fera au Lot 1.

Revision ID: 0001
Revises:
Create Date: 2026-07-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ### Alembic commands (baseline verifiee) ###
    op.create_table('audit_logs',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('ts', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('actor_id', sa.String(length=32), nullable=True),
    sa.Column('actor_label', sa.String(length=200), nullable=True),
    sa.Column('action', sa.String(length=60), nullable=False),
    sa.Column('resource', sa.String(length=200), nullable=True),
    sa.Column('result', sa.String(length=20), nullable=False),
    sa.Column('ip', sa.String(length=60), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_audit_logs_ts'), ['ts'], unique=False)

    op.create_table('features',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('code', sa.String(length=80), nullable=False),
    sa.Column('label', sa.String(length=160), nullable=False),
    sa.Column('type', sa.String(length=10), nullable=False),
    sa.Column('module', sa.String(length=40), nullable=False),
    sa.Column('actions', sa.JSON(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_features_code'), ['code'], unique=True)

    op.create_table('organisations',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('nom', sa.String(length=160), nullable=False),
    sa.Column('slug', sa.String(length=80), nullable=False),
    sa.Column('contact', sa.String(length=160), nullable=True),
    sa.Column('statut', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('slug')
    )
    op.create_table('ai_models',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=True),
    sa.Column('nom', sa.String(length=160), nullable=False),
    sa.Column('version', sa.String(length=40), nullable=False),
    sa.Column('tache', sa.String(length=40), nullable=False),
    sa.Column('framework', sa.String(length=40), nullable=True),
    sa.Column('fichier', sa.String(length=255), nullable=True),
    sa.Column('statut', sa.String(length=20), nullable=False),
    sa.Column('metrics', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('detection_categories',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=True),
    sa.Column('code', sa.String(length=60), nullable=False),
    sa.Column('label', sa.String(length=120), nullable=False),
    sa.Column('couleur', sa.String(length=16), nullable=False),
    sa.Column('type', sa.String(length=20), nullable=False),
    sa.Column('actif', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('roles',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=True),
    sa.Column('nom', sa.String(length=120), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('is_system', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('sites',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=False),
    sa.Column('nom', sa.String(length=160), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('adresse', sa.String(length=240), nullable=True),
    sa.Column('zones', sa.JSON(), nullable=False),
    sa.Column('statut', sa.String(length=20), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('users',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=True),
    sa.Column('email', sa.String(length=200), nullable=False),
    sa.Column('nom', sa.String(length=160), nullable=False),
    sa.Column('password_hash', sa.String(length=255), nullable=True),
    sa.Column('statut', sa.String(length=20), nullable=False),
    sa.Column('is_superadmin', sa.Boolean(), nullable=False),
    sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.create_table('model_categories',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('model_id', sa.String(length=32), nullable=False),
    sa.Column('category_id', sa.String(length=32), nullable=False),
    sa.ForeignKeyConstraint(['category_id'], ['detection_categories.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['model_id'], ['ai_models.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('model_id', 'category_id')
    )
    op.create_table('robots',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('org_id', sa.String(length=32), nullable=True),
    sa.Column('site_id', sa.String(length=32), nullable=True),
    sa.Column('nom', sa.String(length=80), nullable=False),
    sa.Column('serial', sa.String(length=120), nullable=True),
    sa.Column('firmware', sa.String(length=40), nullable=True),
    sa.Column('statut', sa.String(length=20), nullable=False),
    sa.Column('batterie', sa.Integer(), nullable=True),
    sa.Column('capacites', sa.JSON(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['org_id'], ['organisations.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('serial')
    )
    op.create_table('role_permissions',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('role_id', sa.String(length=32), nullable=False),
    sa.Column('feature_id', sa.String(length=32), nullable=False),
    sa.Column('actions', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['feature_id'], ['features.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('role_id', 'feature_id')
    )
    op.create_table('user_roles',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('user_id', sa.String(length=32), nullable=False),
    sa.Column('role_id', sa.String(length=32), nullable=False),
    sa.Column('scope_type', sa.String(length=10), nullable=False),
    sa.Column('scope_id', sa.String(length=32), nullable=True),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'role_id', 'scope_type', 'scope_id')
    )
    op.create_table('livekit_tokens',
    sa.Column('id', sa.String(length=32), nullable=False),
    sa.Column('robot_id', sa.String(length=32), nullable=False),
    sa.Column('room', sa.String(length=160), nullable=False),
    sa.Column('subject', sa.String(length=20), nullable=False),
    sa.Column('identity', sa.String(length=160), nullable=False),
    sa.Column('token', sa.Text(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['robot_id'], ['robots.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('robot_assignments',
    sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
    sa.Column('robot_id', sa.String(length=32), nullable=False),
    sa.Column('user_id', sa.String(length=32), nullable=False),
    sa.Column('op_role', sa.String(length=20), nullable=False),
    sa.ForeignKeyConstraint(['robot_id'], ['robots.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('robot_id', 'user_id')
    )
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### Alembic commands (baseline verifiee) ###
    op.drop_table('robot_assignments')
    op.drop_table('livekit_tokens')
    op.drop_table('user_roles')
    op.drop_table('role_permissions')
    op.drop_table('robots')
    op.drop_table('model_categories')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
    op.drop_table('sites')
    op.drop_table('roles')
    op.drop_table('detection_categories')
    op.drop_table('ai_models')
    op.drop_table('organisations')
    with op.batch_alter_table('features', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_features_code'))

    op.drop_table('features')
    with op.batch_alter_table('audit_logs', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_audit_logs_ts'))

    op.drop_table('audit_logs')
    # ### end Alembic commands ###
