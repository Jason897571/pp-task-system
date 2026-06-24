"""add task_links (related tasks)

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-24 13:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: str | None = 'e5f6a7b8c9d0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'task_links',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_a_id', sa.Integer(), nullable=False),
        sa.Column('task_b_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['task_a_id'], ['tasks.id']),
        sa.ForeignKeyConstraint(['task_b_id'], ['tasks.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_a_id', 'task_b_id', name='uq_task_link_pair'),
    )
    op.create_index('ix_task_links_task_a_id', 'task_links', ['task_a_id'])
    op.create_index('ix_task_links_task_b_id', 'task_links', ['task_b_id'])


def downgrade() -> None:
    op.drop_index('ix_task_links_task_b_id', table_name='task_links')
    op.drop_index('ix_task_links_task_a_id', table_name='task_links')
    op.drop_table('task_links')
