"""Round-2 feature tests: tags, checklists, recurring, files, notifications, stats."""

import io
from datetime import date, datetime

import pytest

from tests.conftest import auth_header
from tests.factory import standard_world


@pytest.fixture
def world(db):
    return standard_world(db)


def _assigned_task(client, world, assignee_key="member"):
    admin = auth_header(client, "admin", "pw")
    return client.post(
        "/api/tasks",
        headers=admin,
        json={
            "title": "任务",
            "board_id": world["board"].id,
            "assignee_id": world[assignee_key].id,
        },
    ).json()


# --------------------------------------------------------------------------
# Tags
# --------------------------------------------------------------------------


def test_create_and_list_tags(client, world):
    h = auth_header(client, "member", "pw")
    r = client.post("/api/tags", headers=h, json={"name": "紧急", "color": "red"})
    assert r.status_code == 200
    assert r.json()["color"] == "red"

    listing = client.get("/api/tags", headers=h).json()
    assert any(t["name"] == "紧急" for t in listing)


def test_create_tag_bad_color(client, world):
    h = auth_header(client, "member", "pw")
    r = client.post("/api/tags", headers=h, json={"name": "x", "color": "rainbow"})
    assert r.status_code == 400


def test_set_task_tags_and_serialization(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    tag1 = client.post("/api/tags", headers=admin, json={"name": "A", "color": "blue"}).json()
    tag2 = client.post("/api/tags", headers=admin, json={"name": "B", "color": "gray"}).json()

    r = client.put(
        f"/api/tasks/{t['id']}/tags", headers=admin, json={"tag_ids": [tag1["id"], tag2["id"]]}
    )
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {tag1["id"], tag2["id"]}

    # Task.tags appears in list + detail
    detail = client.get(f"/api/tasks/{t['id']}", headers=admin).json()
    assert {x["name"] for x in detail["tags"]} == {"A", "B"}

    tasks = client.get("/api/tasks", headers=admin).json()
    card = next(c for c in tasks if c["id"] == t["id"])
    assert len(card["tags"]) == 2

    # full replace
    r2 = client.put(f"/api/tasks/{t['id']}/tags", headers=admin, json={"tag_ids": [tag1["id"]]})
    assert {x["id"] for x in r2.json()} == {tag1["id"]}


def test_assignee_can_set_tags_other_member_cannot(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    member2 = auth_header(client, "member2", "pw")
    t = _assigned_task(client, world, "member")
    tag = client.post("/api/tags", headers=admin, json={"name": "T", "color": "pink"}).json()

    assert client.put(
        f"/api/tasks/{t['id']}/tags", headers=member, json={"tag_ids": [tag["id"]]}
    ).status_code == 200
    assert client.put(
        f"/api/tasks/{t['id']}/tags", headers=member2, json={"tag_ids": [tag["id"]]}
    ).status_code == 403


# --------------------------------------------------------------------------
# Checklists
# --------------------------------------------------------------------------


def test_checklist_crud_and_stats(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)

    cl = client.post(
        f"/api/tasks/{t['id']}/checklists", headers=admin, json={"title": "上线检查"}
    ).json()
    assert cl["title"] == "上线检查" and cl["items"] == []

    i1 = client.post(f"/api/checklists/{cl['id']}/items", headers=admin, json={"content": "跑测试"}).json()
    i2 = client.post(f"/api/checklists/{cl['id']}/items", headers=admin, json={"content": "构建"}).json()

    # checklist_stats: 0/2
    card = next(c for c in client.get("/api/tasks", headers=admin).json() if c["id"] == t["id"])
    assert card["checklist_stats"] == {"done": 0, "total": 2}

    # mark one done -> 1/2
    client.put(f"/api/checklist-items/{i1['id']}", headers=admin, json={"is_done": True})
    card = next(c for c in client.get("/api/tasks", headers=admin).json() if c["id"] == t["id"])
    assert card["checklist_stats"] == {"done": 1, "total": 2}

    # detail has checklists with items
    detail = client.get(f"/api/tasks/{t['id']}", headers=admin).json()
    assert len(detail["checklists"]) == 1
    assert len(detail["checklists"][0]["items"]) == 2

    # rename checklist
    r = client.put(f"/api/checklists/{cl['id']}", headers=admin, json={"title": "新名"})
    assert r.json()["title"] == "新名"

    # delete an item
    client.delete(f"/api/checklist-items/{i2['id']}", headers=admin)
    card = next(c for c in client.get("/api/tasks", headers=admin).json() if c["id"] == t["id"])
    assert card["checklist_stats"] == {"done": 1, "total": 1}

    # delete checklist cascades
    client.delete(f"/api/checklists/{cl['id']}", headers=admin)
    card = next(c for c in client.get("/api/tasks", headers=admin).json() if c["id"] == t["id"])
    assert card["checklist_stats"] == {"done": 0, "total": 0}


def test_checklist_permission(client, world):
    admin = auth_header(client, "admin", "pw")
    member2 = auth_header(client, "member2", "pw")
    t = _assigned_task(client, world, "member")
    r = client.post(f"/api/tasks/{t['id']}/checklists", headers=member2, json={"title": "x"})
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Recurring tasks
# --------------------------------------------------------------------------


def test_recurring_create_and_list(client, world):
    admin = auth_header(client, "admin", "pw")
    r = client.post(
        "/api/recurring-tasks",
        headers=admin,
        json={
            "title": "每周周报",
            "day_of_week": 0,
            "assignee_ids": [world["member"].id, world["member2"].id],
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["day_of_week"] == 0
    assert {a["id"] for a in body["assignees"]} == {world["member"].id, world["member2"].id}

    listing = client.get("/api/recurring-tasks", headers=admin).json()
    assert any(t["title"] == "每周周报" for t in listing)


def test_recurring_admin_cannot_cross_department(client, world):
    admin = auth_header(client, "admin", "pw")
    r = client.post(
        "/api/recurring-tasks",
        headers=admin,
        json={"title": "跨部门", "assignee_ids": [world["mkt_member"].id]},
    )
    assert r.status_code == 403


def test_generate_recurring_instances_pure(client, db, world):
    from app.models import RecurringTask, RecurringTaskAssignee, Task
    from app.services import generate_recurring_instances

    tpl = RecurringTask(
        title="周报",
        creator_id=world["admin"].id,
        department_id=world["rnd"].id,
        priority="normal",
        day_of_week=0,  # Monday
        is_active=True,
    )
    db.add(tpl)
    db.flush()
    db.add_all(
        [
            RecurringTaskAssignee(recurring_task_id=tpl.id, user_id=world["member"].id),
            RecurringTaskAssignee(recurring_task_id=tpl.id, user_id=world["member2"].id),
        ]
    )
    db.commit()
    db.refresh(tpl)

    monday = date(2026, 6, 22)  # a Monday
    created = generate_recurring_instances(db, monday)
    db.commit()
    assert created == 2

    tasks = db.query(Task).filter(Task.recurring_task_id == tpl.id).all()
    assert len(tasks) == 2
    for t in tasks:
        assert t.is_mandatory is True
        assert t.lifecycle == "on_board"
        assert t.column_id == world["cols"]["start"].id
        # due = this week's Friday 18:00 -> 2026-06-26 18:00
        assert t.due_date == datetime(2026, 6, 26, 18, 0)

    # idempotent: a second run for the same week creates nothing
    again = generate_recurring_instances(db, monday)
    db.commit()
    assert again == 0


def test_generate_skips_when_wrong_day(client, db, world):
    from app.models import RecurringTask, RecurringTaskAssignee
    from app.services import generate_recurring_instances

    tpl = RecurringTask(
        title="周三任务",
        creator_id=world["admin"].id,
        department_id=world["rnd"].id,
        day_of_week=2,  # Wednesday
        is_active=True,
    )
    db.add(tpl)
    db.flush()
    db.add(RecurringTaskAssignee(recurring_task_id=tpl.id, user_id=world["member"].id))
    db.commit()

    monday = date(2026, 6, 22)
    assert generate_recurring_instances(db, monday) == 0


def test_recurring_run_now(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    tpl = client.post(
        "/api/recurring-tasks",
        headers=admin,
        # day_of_week unlikely to be today; run-now ignores it
        json={"title": "立即生成", "day_of_week": 3, "assignee_ids": [world["member"].id]},
    ).json()

    r = client.post(f"/api/recurring-tasks/{tpl['id']}/run-now", headers=admin)
    assert r.status_code == 200
    assert r.json()["created"] == 1

    # member now sees a mandatory task
    tasks = client.get("/api/tasks", headers=member).json()
    assert any(t["title"] == "立即生成" and t["is_mandatory"] for t in tasks)


def test_recurring_member_forbidden(client, world):
    member = auth_header(client, "member", "pw")
    r = client.get("/api/recurring-tasks", headers=member)
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Files
# --------------------------------------------------------------------------


def _upload(client, headers, owner_type, owner_id, content=b"hello", name="a.txt", ctype="text/plain"):
    return client.post(
        "/api/files/upload",
        headers=headers,
        files={"file": (name, io.BytesIO(content), ctype)},
        data={"owner_type": owner_type, "owner_id": str(owner_id)},
    )


def test_file_upload_download_and_detail(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)

    r = _upload(client, admin, "task", t["id"], content=b"spec content", name="spec.txt")
    assert r.status_code == 200, r.text
    att = r.json()
    assert att["filename"] == "spec.txt"
    assert att["owner_type"] == "task"
    assert att["uploader"]["id"] == world["admin"].id

    # download
    d = client.get(f"/api/files/{att['id']}", headers=admin)
    assert d.status_code == 200
    assert d.content == b"spec content"

    # appears in TaskDetail.attachments
    detail = client.get(f"/api/tasks/{t['id']}", headers=admin).json()
    assert any(a["id"] == att["id"] for a in detail["attachments"])


def test_file_download_forbidden_for_unrelated(client, world):
    admin = auth_header(client, "admin", "pw")
    mkt_member = auth_header(client, "mkt_member", "pw")
    t = _assigned_task(client, world, "member")
    att = _upload(client, admin, "task", t["id"]).json()
    # market member is unrelated to this 研发部 on-board task
    r = client.get(f"/api/files/{att['id']}", headers=mkt_member)
    assert r.status_code == 403


def test_file_oversize_and_bad_type(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)

    bad = _upload(client, admin, "task", t["id"], name="a.exe", ctype="application/x-msdownload")
    assert bad.status_code == 400

    big = _upload(client, admin, "task", t["id"], content=b"x" * (50 * 1024 * 1024 + 1))
    assert big.status_code == 400


def test_markdown_upload(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)

    # proper markdown MIME
    r = _upload(
        client, admin, "task", t["id"], content=b"# title", name="readme.md", ctype="text/markdown"
    )
    assert r.status_code == 200, r.text

    # browsers/OS often report an empty/generic type for .md — allowed by extension
    r2 = _upload(
        client, admin, "task", t["id"], content=b"# t", name="notes.md", ctype="application/octet-stream"
    )
    assert r2.status_code == 200, r2.text


def test_personal_settings_and_avatar(client, world):
    member = auth_header(client, "member", "pw")
    other = auth_header(client, "member2", "pw")

    # set + clear card colour
    r = client.put("/api/me/settings", headers=member, json={"card_color": "#ff8800"})
    assert r.status_code == 200, r.text
    assert r.json()["card_color"] == "#ff8800"
    assert client.get("/api/auth/me", headers=member).json()["card_color"] == "#ff8800"
    cleared = client.put("/api/me/settings", headers=member, json={"card_color": ""})
    assert cleared.json()["card_color"] is None

    # upload avatar (image) — non-image rejected
    bad = client.post(
        "/api/me/avatar",
        headers=member,
        files={"file": ("a.txt", io.BytesIO(b"x"), "text/plain")},
    )
    assert bad.status_code == 400
    up = client.post(
        "/api/me/avatar",
        headers=member,
        files={"file": ("me.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )
    assert up.status_code == 200, up.text
    att_id = up.json()["avatar_attachment_id"]
    assert att_id is not None

    # avatar is downloadable by ANY authenticated user (shown across the app)
    assert client.get(f"/api/files/{att_id}", headers=other).status_code == 200


def test_deliverable_attachment(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world, "member")
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "done"})
    detail = client.get(f"/api/tasks/{t['id']}", headers=member).json()
    deliverable_id = detail["deliverables"][0]["id"]

    r = _upload(client, member, "deliverable", deliverable_id, name="out.pdf", ctype="application/pdf", content=b"%PDF")
    assert r.status_code == 200

    detail2 = client.get(f"/api/tasks/{t['id']}", headers=member).json()
    assert len(detail2["deliverables"][0]["attachments"]) == 1


# --------------------------------------------------------------------------
# Notifications
# --------------------------------------------------------------------------


def test_notification_on_assign_and_review(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")

    # assign creates notification for assignee
    t = _assigned_task(client, world, "member")
    notes = client.get("/api/notifications", headers=member).json()
    assert any(n["type"] == "assigned" and n["related_task_id"] == t["id"] for n in notes)

    # full lifecycle -> review approve notifies assignee
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "v1"})

    # submit notifies the reviewing admin
    admin_notes = client.get("/api/notifications", headers=admin).json()
    assert any(n["type"] == "submitted" for n in admin_notes)

    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})
    notes2 = client.get("/api/notifications", headers=member).json()
    assert any(n["type"] == "reviewed" for n in notes2)


def test_notification_read_and_read_all(client, world):
    member = auth_header(client, "member", "pw")
    _assigned_task(client, world, "member")
    _assigned_task(client, world, "member")

    notes = client.get("/api/notifications", headers=member).json()
    assert len(notes) >= 2
    assert all(n["is_read"] is False for n in notes)

    # newest first
    assert notes == sorted(notes, key=lambda n: n["created_at"], reverse=True)

    first = notes[0]["id"]
    assert client.post(f"/api/notifications/{first}/read", headers=member).status_code == 200
    refreshed = client.get("/api/notifications", headers=member).json()
    assert next(n for n in refreshed if n["id"] == first)["is_read"] is True

    assert client.post("/api/notifications/read-all", headers=member).status_code == 200
    refreshed2 = client.get("/api/notifications", headers=member).json()
    assert all(n["is_read"] is True for n in refreshed2)


def test_notification_on_pool_apply(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = client.post(
        "/api/tasks", headers=admin, json={"title": "池", "board_id": world["board"].id}
    ).json()
    client.post(f"/api/tasks/{t['id']}/apply", headers=member)
    admin_notes = client.get("/api/notifications", headers=admin).json()
    assert any(n["type"] == "applied" and n["related_task_id"] == t["id"] for n in admin_notes)


# --------------------------------------------------------------------------
# Stats
# --------------------------------------------------------------------------


def test_stats_overview(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    bid = world["board"].id

    # one on-board task in start, one open in pool
    _assigned_task(client, world, "member")
    client.post("/api/tasks", headers=admin, json={"title": "池1", "board_id": bid})

    r = client.get(f"/api/stats/overview?board_id={bid}", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["pool_count"] == 1
    start_col = next(c for c in body["by_column"] if c["column_id"] == world["cols"]["start"].id)
    assert start_col["count"] == 1
    assert body["overdue_count"] == 0


def test_stats_overdue(client, db, world):
    from app.models import Task

    admin = auth_header(client, "admin", "pw")
    # create an overdue on-board task directly
    db.add(
        Task(
            title="逾期",
            creator_id=world["admin"].id,
            assignee_id=world["member"].id,
            department_id=world["rnd"].id,
            board_id=world["board"].id,
            column_id=world["cols"]["doing"].id,
            lifecycle="on_board",
            due_date=datetime(2020, 1, 1, 0, 0),
        )
    )
    db.commit()
    r = client.get(f"/api/stats/overview?board_id={world['board'].id}", headers=admin).json()
    assert r["overdue_count"] == 1


def test_stats_members(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world, "member")
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "x"})

    rows = client.get("/api/stats/members", headers=admin).json()
    member_row = next(r for r in rows if r["user"]["id"] == world["member"].id)
    assert member_row["total"] >= 1
    assert member_row["in_review"] == 1
    assert member_row["done"] == 0


def test_stats_admin_department_scoping(client, world):
    admin = auth_header(client, "admin", "pw")  # 研发部
    mkt_admin = auth_header(client, "mkt_admin", "pw")  # 市场部

    # a 研发部 task
    _assigned_task(client, world, "member")

    rnd_rows = client.get("/api/stats/members", headers=admin).json()
    rnd_ids = {r["user"]["id"] for r in rnd_rows}
    assert world["member"].id in rnd_ids
    assert world["mkt_member"].id not in rnd_ids

    mkt_rows = client.get("/api/stats/members", headers=mkt_admin).json()
    mkt_ids = {r["user"]["id"] for r in mkt_rows}
    assert world["mkt_member"].id in mkt_ids
    assert world["member"].id not in mkt_ids


def test_stats_member_forbidden(client, world):
    member = auth_header(client, "member", "pw")
    assert client.get("/api/stats/overview", headers=member).status_code == 403
    assert client.get("/api/stats/members", headers=member).status_code == 403
