"""add board_columns.requires_review

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-21 17:30:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c3d4e5f6a7b8'
down_revision: str | None = 'b2c3d4e5f6a7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'board_columns',
        sa.Column('requires_review', sa.Boolean(), nullable=False, server_default='0'),
    )
    # Preserve current behaviour: existing kind=='review' columns become the review gate.
    op.execute("UPDATE board_columns SET requires_review = 1 WHERE kind = 'review'")


def downgrade() -> None:
    op.drop_column('board_columns', 'requires_review')
