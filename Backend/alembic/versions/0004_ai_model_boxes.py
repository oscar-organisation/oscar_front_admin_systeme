"""Versioned AI model boxes and scoped assignments.

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-12
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_model_boxes",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(160), nullable=False),
        sa.Column("version", sa.String(40), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("statut", sa.String(20), server_default="draft", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint("org_id", "nom", "version", name="uq_ai_model_box_org_name_version"),
    )
    op.create_table(
        "ai_model_box_items",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("box_id", sa.String(32), sa.ForeignKey("ai_model_boxes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_id", sa.String(32), sa.ForeignKey("ai_models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("inference_fps", sa.Integer(), server_default="5", nullable=False),
        sa.Column("confidence", sa.Integer(), server_default="25", nullable=False),
        sa.Column("iou_threshold", sa.Integer(), server_default="45", nullable=False),
        sa.Column("overlay_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("incident_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("camera", sa.String(80), server_default="primary", nullable=False),
        sa.Column("config", sa.JSON(), server_default="{}", nullable=False),
        sa.UniqueConstraint("box_id", "model_id", name="uq_ai_model_box_item_model"),
    )
    op.create_table(
        "ai_model_box_assignments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("box_id", sa.String(32), sa.ForeignKey("ai_model_boxes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE")),
        sa.Column("fleet_id", sa.String(32), sa.ForeignKey("fleets.id", ondelete="CASCADE")),
        sa.Column("site_id", sa.String(32), sa.ForeignKey("sites.id", ondelete="CASCADE")),
        sa.Column("enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.CheckConstraint(
            "(CASE WHEN robot_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN fleet_id IS NOT NULL THEN 1 ELSE 0 END + "
            "CASE WHEN site_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_ai_model_box_assignment_one_target",
        ),
        sa.UniqueConstraint("box_id", "robot_id", name="uq_ai_model_box_assignment_robot"),
        sa.UniqueConstraint("box_id", "fleet_id", name="uq_ai_model_box_assignment_fleet"),
        sa.UniqueConstraint("box_id", "site_id", name="uq_ai_model_box_assignment_site"),
    )


def downgrade() -> None:
    op.drop_table("ai_model_box_assignments")
    op.drop_table("ai_model_box_items")
    op.drop_table("ai_model_boxes")
