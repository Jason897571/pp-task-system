"""add board_columns.source_board_id (per-board archive columns)

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-22 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'e5f6a7b8c9d0'
down_revision: str | None = 'd4e5f6a7b8c9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('board_columns', sa.Column('source_board_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('board_columns', 'source_board_id')
