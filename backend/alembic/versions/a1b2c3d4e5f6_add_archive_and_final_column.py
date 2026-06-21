"""add board.is_archive and board_columns.is_final

Revision ID: a1b2c3d4e5f6
Revises: 6995226e64d4
Create Date: 2026-06-21 15:20:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = '6995226e64d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'boards',
        sa.Column('is_archive', sa.Boolean(), nullable=False, server_default='0'),
    )
    op.add_column(
        'board_columns',
        sa.Column('is_final', sa.Boolean(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('board_columns', 'is_final')
    op.drop_column('boards', 'is_archive')
