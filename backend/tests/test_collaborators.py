"""Tests for task collaborators (multi-person collaboration)."""

import io

from sqlalchemy import select

from app.models import Notification, Task
from app.schemas import DuplicateIn
from app.services import can_edit_task, is_task_worker
from tests.conftest import auth_header
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


def test_task_detail_returns_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.get(f"/api/tasks/{task.id}", headers=h)

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]


def test_collaborator_can_see_and_move_task(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 200

    resp = client.post(
        f"/api/tasks/{task.id}/move",
        json={"column_id": w["cols"]["doing"].id},
        headers=h,
    )
    assert resp.status_code == 200, resp.text


def test_non_collaborator_cannot_see_task(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "mkt_member", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 403


def test_collaborator_can_start_and_submit(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    assert client.post(f"/api/tasks/{task.id}/start", headers=h).status_code == 200
    resp = client.post(f"/api/tasks/{task.id}/submit", json={"note": "做完了"}, headers=h)
    assert resp.status_code == 200, resp.text


def test_out_of_scope_admin_collaborator_can_see_task(client, db):
    # mkt_admin is a 市场部 admin, not creator/assignee, and the task is a
    # 研发部 task, so admin_can_touch_task(mkt_admin, task) is False. Being
    # added as a collaborator is the only reason they can see it.
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["mkt_admin"]])
    h = auth_header(client, "mkt_admin", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 200


def test_out_of_scope_admin_not_collaborator_cannot_see_task(client, db):
    # Control for the test above: same admin, same task, but not added as a
    # collaborator this time — must be 403. Proves the 200 above is caused by
    # the collaborator relationship, not by the admin role itself.
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "mkt_admin", "pw")

    assert client.get(f"/api/tasks/{task.id}", headers=h).status_code == 403


def test_out_of_scope_admin_collaborator_can_start_and_submit(client, db):
    # Same widening on the edit/submit side (can_edit_task), not just visibility.
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["mkt_admin"]])
    h = auth_header(client, "mkt_admin", "pw")

    assert client.post(f"/api/tasks/{task.id}/start", headers=h).status_code == 200
    resp = client.post(f"/api/tasks/{task.id}/submit", json={"note": "做完了"}, headers=h)
    assert resp.status_code == 200, resp.text


def test_assignee_can_set_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "member", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators",
        json={"user_ids": [w["member2"].id]},
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("协作" in n.message for n in notes)


def test_setting_collaborators_drops_removed_and_notifies(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators", json={"user_ids": []}, headers=h
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["collaborators"] == []
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("移出" in n.message for n in notes)


def test_collaborator_list_excludes_the_assignee(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"])
    h = auth_header(client, "admin", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators",
        json={"user_ids": [w["member"].id, w["member2"].id]},
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]


def test_collaborator_cannot_edit_the_collaborator_list(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "member2", "pw")

    resp = client.put(
        f"/api/tasks/{task.id}/collaborators", json={"user_ids": []}, headers=h
    )

    assert resp.status_code == 403


def test_create_task_with_collaborators(client, db):
    w = standard_world(db)
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        "/api/tasks",
        json={
            "title": "带协作人的任务",
            "board_id": w["board"].id,
            "assignee_id": w["member"].id,
            "collaborator_ids": [w["member2"].id],
        },
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["member2"].id]


def test_create_pool_task_ignores_collaborator_ids(client, db):
    # Pool tasks have no assignee, and collaborators may only exist alongside
    # an owner (see test_to_pool_clears_collaborators). An admin creating a
    # pool task with collaborator_ids must not end up with collaborators.
    w = standard_world(db)
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        "/api/tasks",
        json={
            "title": "需求池任务",
            "board_id": w["board"].id,
            "department_id": w["rnd"].id,
            "collaborator_ids": [w["member2"].id],
        },
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["lifecycle"] == "open"
    assert body["assignee"] is None
    assert body["collaborators"] == []


def _make_pool_task(client, w, h):
    resp = client.post(
        "/api/tasks",
        json={
            "title": "需求池任务",
            "board_id": w["board"].id,
            "department_id": w["rnd"].id,
        },
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_set_collaborators_rejected_on_pool_task(client, db):
    # A pool task has no assignee to collaborate with — set_collaborators must
    # reject even though admin_can_touch_task passes, closing the second path
    # (besides create_task) to an ownerless task with collaborators.
    w = standard_world(db)
    h = auth_header(client, "admin", "pw")
    task_id = _make_pool_task(client, w, h)

    resp = client.put(
        f"/api/tasks/{task_id}/collaborators",
        json={"user_ids": [w["member2"].id]},
        headers=h,
    )

    assert resp.status_code == 409, resp.text
    task = db.get(Task, task_id)
    assert task.collaborators == []


def test_set_collaborators_rejected_on_pool_task_even_with_empty_list(client, db):
    # Setting an empty list on a pool task would be a no-op reaching the same
    # end state the rule wants, but the guard rejects it unconditionally so the
    # invariant doesn't depend on the caller's payload.
    w = standard_world(db)
    h = auth_header(client, "admin", "pw")
    task_id = _make_pool_task(client, w, h)

    resp = client.put(
        f"/api/tasks/{task_id}/collaborators",
        json={"user_ids": []},
        headers=h,
    )

    assert resp.status_code == 409, resp.text


def test_reassign_keeps_collaborators_and_dedupes(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        f"/api/tasks/{task.id}/assign", json={"assignee_id": w["member2"].id}, headers=h
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["assignee"]["id"] == w["member2"].id
    # the new owner is dropped from the collaborator list; the old owner is NOT
    # auto-added as a collaborator
    assert resp.json()["collaborators"] == []


def test_to_pool_clears_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.post(f"/api/tasks/{task.id}/to-pool", headers=h)

    assert resp.status_code == 200, resp.text
    assert resp.json()["collaborators"] == []
    notes = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("需求池" in n.message for n in notes)


def test_task_list_by_assignee_includes_collaborations(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    # unrelated task: member2 is neither owner nor collaborator here
    _make_task(db, w, w["member"])
    h = auth_header(client, "admin", "pw")

    resp = client.get(f"/api/tasks?assignee={w['member2'].id}", headers=h)

    assert resp.status_code == 200, resp.text
    assert [t["id"] for t in resp.json()] == [task.id]


def test_collaborator_can_download_task_attachment(client, db):
    # A collaborator may upload to the task (can_edit_task), so they must be able
    # to download too — inline images in the description/comments render through
    # the same endpoint.
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    admin = auth_header(client, "admin", "pw")

    up = client.post(
        "/api/files/upload",
        headers=admin,
        files={"file": ("spec.txt", io.BytesIO(b"spec content"), "text/plain")},
        data={"owner_type": "task", "owner_id": str(task.id)},
    )
    assert up.status_code == 200, up.text
    file_id = up.json()["id"]

    collab = auth_header(client, "member2", "pw")
    resp = client.get(f"/api/files/{file_id}", headers=collab)
    assert resp.status_code == 200, resp.text
    assert resp.content == b"spec content"

    # an unrelated member of another department still gets 403
    outsider = auth_header(client, "mkt_member", "pw")
    assert client.get(f"/api/files/{file_id}", headers=outsider).status_code == 403


def test_can_manage_false_for_out_of_scope_admin_collaborator(client, db):
    # An out-of-department admin who is only a collaborator can see the card but
    # must not be offered the manager actions — every one of them 403s.
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["mkt_admin"]])

    r = client.get(f"/api/tasks/{task.id}", headers=auth_header(client, "mkt_admin", "pw"))
    assert r.status_code == 200, r.text
    assert r.json()["can_manage"] is False

    r = client.get(f"/api/tasks/{task.id}", headers=auth_header(client, "admin", "pw"))
    assert r.status_code == 200, r.text
    assert r.json()["can_manage"] is True


def test_assign_notifies_added_and_removed_collaborators(client, db):
    w = standard_world(db)
    task = _make_task(db, w, w["member"], [w["member2"]])
    h = auth_header(client, "admin", "pw")

    resp = client.post(
        f"/api/tasks/{task.id}/assign",
        json={"assignee_id": w["member"].id, "collaborator_ids": [w["mkt_member"].id]},
        headers=h,
    )

    assert resp.status_code == 200, resp.text
    assert [c["id"] for c in resp.json()["collaborators"]] == [w["mkt_member"].id]
    added = db.scalars(
        select(Notification).where(Notification.user_id == w["mkt_member"].id)
    ).all()
    assert any("加入任务" in n.message for n in added)
    removed = db.scalars(
        select(Notification).where(Notification.user_id == w["member2"].id)
    ).all()
    assert any("移出任务" in n.message for n in removed)


def test_duplicate_in_schema_has_no_collaborator_ids_field():
    # duplicate has its own body schema — collaborator_ids is not part of its
    # contract (unlike AssignIn, which the endpoint used to reuse). Because
    # Pydantic's default extra="ignore", a request round-trip can't distinguish
    # this from AssignIn's behavior, so we pin it directly on the schema.
    assert "collaborator_ids" not in DuplicateIn.model_fields
    assert set(DuplicateIn.model_fields) == {"assignee_id"}
