"""IAM hierarchy, teams, permission bundles and fleets.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "organisation_categories",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("code", sa.String(60), nullable=False, unique=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("description", sa.Text()),
        *_timestamps(),
    )
    op.create_index("ix_organisation_categories_code", "organisation_categories", ["code"], unique=True)
    op.add_column("organisations", sa.Column("category_id", sa.String(32)))
    op.add_column("organisations", sa.Column("parent_id", sa.String(32)))
    op.create_foreign_key(
        "fk_organisations_category", "organisations", "organisation_categories",
        ["category_id"], ["id"], ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_organisations_parent", "organisations", "organisations",
        ["parent_id"], ["id"], ondelete="SET NULL",
    )
    op.add_column(
        "roles", sa.Column("visibility", sa.String(20), server_default="private", nullable=False)
    )
    op.execute("UPDATE roles SET visibility = 'public' WHERE is_system = true OR org_id IS NULL")

    op.create_table(
        "user_organisations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.false(), nullable=False),
        *_timestamps(),
        sa.UniqueConstraint("user_id", "org_id"),
    )
    op.execute(
        "INSERT INTO user_organisations (user_id, org_id, is_primary) "
        "SELECT id, org_id, true FROM users WHERE org_id IS NOT NULL"
    )

    op.create_table(
        "teams",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("statut", sa.String(20), server_default="active", nullable=False),
        *_timestamps(),
    )
    op.create_table(
        "team_members",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("team_id", sa.String(32), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(80)),
        *_timestamps(),
        sa.UniqueConstraint("team_id", "user_id"),
    )
    op.create_table(
        "team_organisations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("team_id", sa.String(32), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("team_id", "org_id"),
    )

    op.create_table(
        "permission_groups",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE")),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("visibility", sa.String(20), server_default="private", nullable=False),
        *_timestamps(),
    )
    op.create_table(
        "permission_group_permissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.String(32), sa.ForeignKey("permission_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("feature_id", sa.String(32), sa.ForeignKey("features.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actions", sa.JSON(), nullable=False),
        sa.UniqueConstraint("group_id", "feature_id"),
    )
    op.create_table(
        "role_permission_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("role_id", sa.String(32), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_group_id", sa.String(32), sa.ForeignKey("permission_groups.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("role_id", "permission_group_id"),
    )

    op.create_table(
        "role_groups",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE")),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("visibility", sa.String(20), server_default="private", nullable=False),
        *_timestamps(),
    )
    op.create_table(
        "role_group_roles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("group_id", sa.String(32), sa.ForeignKey("role_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.String(32), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("group_id", "role_id"),
    )
    op.create_table(
        "role_group_permission_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("role_group_id", sa.String(32), sa.ForeignKey("role_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_group_id", sa.String(32), sa.ForeignKey("permission_groups.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("role_group_id", "permission_group_id"),
    )
    op.create_table(
        "user_role_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(32), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_group_id", sa.String(32), sa.ForeignKey("role_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(10), server_default="all", nullable=False),
        sa.Column("scope_id", sa.String(32)),
        sa.UniqueConstraint("user_id", "role_group_id", "scope_type", "scope_id"),
    )
    op.create_table(
        "team_roles",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("team_id", sa.String(32), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", sa.String(32), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(10), server_default="all", nullable=False),
        sa.Column("scope_id", sa.String(32)),
        sa.UniqueConstraint("team_id", "role_id", "scope_type", "scope_id"),
    )
    op.create_table(
        "team_role_groups",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("team_id", sa.String(32), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_group_id", sa.String(32), sa.ForeignKey("role_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("scope_type", sa.String(10), server_default="all", nullable=False),
        sa.Column("scope_id", sa.String(32)),
        sa.UniqueConstraint("team_id", "role_group_id", "scope_type", "scope_id"),
    )

    op.create_table(
        "fleets",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(120), nullable=False),
        sa.Column("code", sa.String(60), nullable=False),
        sa.Column("description", sa.Text()),
        *_timestamps(),
        sa.UniqueConstraint("org_id", "code"),
    )
    op.create_table(
        "fleet_robots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("fleet_id", sa.String(32), sa.ForeignKey("fleets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("fleet_id", "robot_id"),
    )


def downgrade() -> None:
    for table in [
        "fleet_robots", "fleets", "team_role_groups", "team_roles", "user_role_groups",
        "role_group_permission_groups", "role_group_roles", "role_groups",
        "role_permission_groups", "permission_group_permissions", "permission_groups",
        "team_organisations", "team_members", "teams", "user_organisations",
    ]:
        op.drop_table(table)
    op.drop_column("roles", "visibility")
    op.drop_constraint("fk_organisations_parent", "organisations", type_="foreignkey")
    op.drop_constraint("fk_organisations_category", "organisations", type_="foreignkey")
    op.drop_column("organisations", "parent_id")
    op.drop_column("organisations", "category_id")
    op.drop_index("ix_organisation_categories_code", table_name="organisation_categories")
    op.drop_table("organisation_categories")
