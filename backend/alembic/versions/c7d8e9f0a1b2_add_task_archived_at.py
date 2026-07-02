"""add tasks.archived_at (archive board weekly view)

Revision ID: c7d8e9f0a1b2
Revises: b8c9d0e1f2a3
Create Date: 2026-07-02 10:00:00.000000

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d8e9f0a1b2'
down_revision: str | None = 'b8c9d0e1f2a3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('tasks', sa.Column('archived_at', sa.DateTime(), nullable=True))
    # Backfill: cards already sitting on the archive board have no archive time
    # recorded. Use updated_at as a best-effort proxy so the weekly view isn't
    # empty for history. (Non-archive cards keep archived_at = NULL.)
    op.execute(
        """
        UPDATE tasks
        SET archived_at = updated_at
        WHERE archived_at IS NULL
          AND board_id IN (SELECT id FROM boards WHERE is_archive = 1)
        """
    )


def downgrade() -> None:
    op.drop_column('tasks', 'archived_at')
