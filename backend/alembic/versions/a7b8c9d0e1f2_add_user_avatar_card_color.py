"""add users.avatar_attachment_id + users.card_color (personal settings)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-26 13:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a7b8c9d0e1f2'
down_revision: str | None = 'f6a7b8c9d0e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('avatar_attachment_id', sa.Integer(), nullable=True))
    op.add_column('users', sa.Column('card_color', sa.String(length=9), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'card_color')
    op.drop_column('users', 'avatar_attachment_id')
