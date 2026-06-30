"""add users.phone + users.feishu_open_id (Feishu @-mention identity)

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-30 12:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'b8c9d0e1f2a3'
down_revision: str | None = 'a7b8c9d0e1f2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('phone', sa.String(length=32), nullable=True))
    op.add_column('users', sa.Column('feishu_open_id', sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'feishu_open_id')
    op.drop_column('users', 'phone')
