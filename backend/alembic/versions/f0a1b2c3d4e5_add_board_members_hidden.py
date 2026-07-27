"""add boards.members_hidden (hide board from all members)

Revision ID: f0a1b2c3d4e5
Revises: e9f0a1b2c3d4
Create Date: 2026-07-27 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f0a1b2c3d4e5'
down_revision: str | None = 'e9f0a1b2c3d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        'boards',
        sa.Column('members_hidden', sa.Boolean(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    op.drop_column('boards', 'members_hidden')
