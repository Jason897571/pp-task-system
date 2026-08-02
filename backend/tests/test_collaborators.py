"""Tests for task collaborators (multi-person collaboration)."""

from app.models import Task
from app.services import can_edit_task, is_task_worker
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


def _make_task(db, w, assignee, collaborators=()):
    task = Task(
        title="协作任务",
        creator_id=w["admin"].id,
        assignee_id=assignee.id,
        board_id=w["board"].id,
        department_id=w["rnd"].id,
        column_id=w["cols"]["start"].id,
        lifecycle="on_board",
    )
    task.collaborators = list(collaborators)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def test_is_task_worker_covers_assignee_and_collaborators(db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])

    assert is_task_worker(w["member"], task) is True
    assert is_task_worker(w["member2"], task) is True
    assert is_task_worker(w["mkt_member"], task) is False


def test_collaborator_can_edit_task(db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])

    assert can_edit_task(w["member2"], task) is True
    assert can_edit_task(w["mkt_member"], task) is False
