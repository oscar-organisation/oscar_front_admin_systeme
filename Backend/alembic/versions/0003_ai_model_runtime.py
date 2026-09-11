"""AI model registry and per-robot deployments.

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ai_models", sa.Column("runtime", sa.String(40), server_default="onnxruntime", nullable=False))
    op.add_column("ai_models", sa.Column("description", sa.Text()))
    op.alter_column("ai_models", "fichier", type_=sa.String(512), existing_type=sa.String(255))
    op.add_column("ai_models", sa.Column("artifact_name", sa.String(255)))
    op.add_column("ai_models", sa.Column("artifact_sha256", sa.String(64)))
    op.add_column("ai_models", sa.Column("artifact_size", sa.Integer()))
    op.add_column("ai_models", sa.Column("artifact_trusted", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("ai_models", sa.Column("validation_status", sa.String(24), server_default="manifest_valid", nullable=False))
    op.add_column("ai_models", sa.Column("validation_errors", sa.JSON(), server_default="[]", nullable=False))
    op.add_column("ai_models", sa.Column("input_spec", sa.JSON(), server_default="{}", nullable=False))
    op.add_column("ai_models", sa.Column("output_spec", sa.JSON(), server_default="{}", nullable=False))
    op.add_column("ai_models", sa.Column("labels", sa.JSON(), server_default="[]", nullable=False))
    op.create_unique_constraint("uq_ai_model_org_name_version", "ai_models", ["org_id", "nom", "version"])

    op.create_table(
        "ai_model_deployments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("org_id", sa.String(32), sa.ForeignKey("organisations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("model_id", sa.String(32), sa.ForeignKey("ai_models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("robot_id", sa.String(32), sa.ForeignKey("robots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("inference_fps", sa.Integer(), server_default="5", nullable=False),
        sa.Column("confidence", sa.Integer(), server_default="25", nullable=False),
        sa.Column("iou_threshold", sa.Integer(), server_default="45", nullable=False),
        sa.Column("overlay_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("incident_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("config", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.UniqueConstraint("model_id", "robot_id", name="uq_ai_model_deployment_robot"),
    )


def downgrade() -> None:
    op.drop_table("ai_model_deployments")
    op.drop_constraint("uq_ai_model_org_name_version", "ai_models", type_="unique")
    for column in (
        "labels", "output_spec", "input_spec", "validation_errors", "validation_status",
        "artifact_trusted", "artifact_size", "artifact_sha256", "artifact_name", "description", "runtime",
    ):
        op.drop_column("ai_models", column)
    op.alter_column("ai_models", "fichier", type_=sa.String(255), existing_type=sa.String(512))
