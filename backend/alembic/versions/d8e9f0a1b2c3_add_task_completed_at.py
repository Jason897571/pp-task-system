"""add tasks.completed_at (completion time for weekly stats)

Revision ID: d8e9f0a1b2c3
Revises: c7d8e9f0a1b2
Create Date: 2026-07-13 10:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd8e9f0a1b2c3'
down_revision: str | None = 'c7d8e9f0a1b2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('completed_at', sa.DateTime(), nullable=True))
    # Backfill: already-archived cards have no completion time recorded. Their
    # archive time (weekly-batch write) is the closest proxy for when they were
    # completed. Cards never archived keep completed_at = NULL.
    op.execute(
        """
        UPDATE tasks
        SET completed_at = archived_at
        WHERE archived_at IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_column('tasks', 'completed_at')
