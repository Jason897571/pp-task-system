"""Tests for task collaborators (multi-person collaboration)."""

from app.models import Task
from tests.factory import standard_world


def test_task_collaborators_round_trip(db):
    w = standard_world(db)
    task = Task(
        title="协作任务",
        creator_id=w["admin"].id,
        assignee_id=w["member"].id,
        board_id=w["board"].id,
        department_id=w["rnd"].id,
        column_id=w["cols"]["start"].id,
        lifecycle="on_board",
    )
    task.collaborators = [w["member2"]]
    db.add(task)
    db.commit()
    db.refresh(task)

    assert [c.id for c in task.collaborators] == [w["member2"].id]
