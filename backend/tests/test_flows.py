import pytest

from tests.conftest import auth_header
from tests.factory import standard_world


@pytest.fixture
def world(db):
    return standard_world(db)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------


def test_login_and_me(client, world):
    h = auth_header(client, "member", "pw")
    me = client.get("/api/auth/me", headers=h)
    assert me.status_code == 200
    body = me.json()
    assert body["full_name"] == "研发成员"
    assert body["username"] == "member"
    assert body["account_status"] == "active"


def test_login_wrong_password(client, world):
    r = client.post("/api/auth/login", json={"username": "member", "password": "nope"})
    assert r.status_code == 401


def test_register_via_invite(client, world):
    h = auth_header(client, "super", "pw")
    r = client.post(
        "/api/admin/users",
        headers=h,
        json={"full_name": "新人", "department_id": world["rnd"].id, "role": "member"},
    )
    assert r.status_code == 200
    code = r.json()["invite_code"]
    assert r.json()["account_status"] == "invited"

    reg = client.post(
        "/api/auth/register",
        json={"invite_code": code, "username": "newbie", "password": "secret"},
    )
    assert reg.status_code == 200
    assert reg.json()["user"]["full_name"] == "新人"

    # invite code now consumed
    reg2 = client.post(
        "/api/auth/register",
        json={"invite_code": code, "username": "other", "password": "secret"},
    )
    assert reg2.status_code == 400


def test_no_auth_is_401(client, world):
    assert client.get("/api/auth/me").status_code == 401


# --------------------------------------------------------------------------
# Admin / role permission matrix
# --------------------------------------------------------------------------


def test_member_cannot_create_department(client, world):
    h = auth_header(client, "member", "pw")
    r = client.post("/api/admin/departments", headers=h, json={"name": "X"})
    assert r.status_code == 403


def test_admin_cannot_use_admin_endpoints(client, world):
    h = auth_header(client, "admin", "pw")
    assert client.get("/api/admin/users", headers=h).status_code == 403


def test_super_admin_creates_user_returns_invite(client, world):
    h = auth_header(client, "super", "pw")
    r = client.post(
        "/api/admin/users",
        headers=h,
        json={"full_name": "李四", "department_id": world["rnd"].id, "role": "member"},
    )
    assert r.status_code == 200
    assert "invite_code" in r.json() and r.json()["invite_code"]


def test_super_admin_update_user(client, world):
    h = auth_header(client, "super", "pw")
    r = client.put(
        f"/api/admin/users/{world['member'].id}",
        headers=h,
        json={"role": "admin"},
    )
    assert r.status_code == 200
    assert r.json()["role"] == "admin"


# --------------------------------------------------------------------------
# Board visibility filtering + super_admin column edit
# --------------------------------------------------------------------------


def test_board_visibility_restriction(client, db, world):
    from app.models import BoardVisibility

    # restrict board to 市场部 only
    db.add(BoardVisibility(board_id=world["board"].id, department_id=world["mkt"].id))
    db.commit()

    rnd_admin = auth_header(client, "admin", "pw")
    boards = client.get("/api/boards", headers=rnd_admin).json()
    assert all(b["id"] != world["board"].id for b in boards)

    mkt_admin = auth_header(client, "mkt_admin", "pw")
    boards2 = client.get("/api/boards", headers=mkt_admin).json()
    assert any(b["id"] == world["board"].id for b in boards2)

    # super_admin always sees it
    sup = auth_header(client, "super", "pw")
    boards3 = client.get("/api/boards", headers=sup).json()
    assert any(b["id"] == world["board"].id for b in boards3)


def test_board_with_no_visibility_is_global(client, world):
    h = auth_header(client, "member", "pw")
    boards = client.get("/api/boards", headers=h).json()
    assert any(b["id"] == world["board"].id for b in boards)


def test_create_board(client, world):
    sup = auth_header(client, "super", "pw")
    # super_admin creates a board -> comes back with the 4 default columns
    r = client.post("/api/boards", headers=sup, json={"name": "合同看板"})
    assert r.status_code == 200
    board = r.json()
    assert board["name"] == "合同看板"
    cols = client.get(f"/api/boards/{board['id']}/columns", headers=sup).json()
    assert [c["name"] for c in cols] == ["待办", "进行中", "待审核", "已完成"]
    assert [c["kind"] for c in cols] == ["start", "doing", "review", "done"]
    # it shows up in the board list
    boards = client.get("/api/boards", headers=sup).json()
    assert any(b["id"] == board["id"] for b in boards)


def test_create_board_requires_super_admin(client, world):
    admin = auth_header(client, "admin", "pw")
    assert client.post("/api/boards", headers=admin, json={"name": "X"}).status_code == 403
    sup = auth_header(client, "super", "pw")
    assert client.post("/api/boards", headers=sup, json={"name": "  "}).status_code == 400


def test_super_admin_column_crud(client, world):
    sup = auth_header(client, "super", "pw")
    bid = world["board"].id
    # add a column
    r = client.post(f"/api/boards/{bid}/columns", headers=sup, json={"name": "复核", "kind": None})
    assert r.status_code == 200
    new_col = r.json()
    # rename it
    r2 = client.put(f"/api/columns/{new_col['id']}", headers=sup, json={"name": "二次复核"})
    assert r2.status_code == 200 and r2.json()["name"] == "二次复核"
    # delete it
    r3 = client.delete(f"/api/columns/{new_col['id']}", headers=sup)
    assert r3.status_code == 200 and r3.json()["ok"] is True


def test_member_cannot_edit_columns(client, world):
    h = auth_header(client, "member", "pw")
    r = client.post(
        f"/api/boards/{world['board'].id}/columns", headers=h, json={"name": "X", "kind": None}
    )
    assert r.status_code == 403


def test_delete_column_migrates_cards(client, db, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    bid = world["board"].id
    # admin creates assigned task -> lands in start column (待办)
    t = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "迁移卡", "board_id": bid, "assignee_id": world["member"].id},
    ).json()
    start_col = world["cols"]["start"].id
    assert t["column_id"] == start_col

    # delete the start column; card migrates to first remaining column
    r = client.delete(f"/api/columns/{start_col}", headers=sup)
    assert r.status_code == 200
    detail = client.get(f"/api/tasks/{t['id']}", headers=admin).json()
    assert detail["column_id"] != start_col
    assert detail["column_id"] is not None


# --------------------------------------------------------------------------
# Task creation routing
# --------------------------------------------------------------------------


def test_admin_create_with_assignee_goes_on_board_start(client, world):
    h = auth_header(client, "admin", "pw")
    r = client.post(
        "/api/tasks",
        headers=h,
        json={"title": "T", "board_id": world["board"].id, "assignee_id": world["member"].id},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lifecycle"] == "on_board"
    assert body["column_id"] == world["cols"]["start"].id


def test_admin_create_without_assignee_goes_open(client, world):
    h = auth_header(client, "admin", "pw")
    r = client.post("/api/tasks", headers=h, json={"title": "P", "board_id": world["board"].id})
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "open"
    assert r.json()["column_id"] is None


def test_member_create_goes_pending_approval(client, world):
    h = auth_header(client, "member", "pw")
    r = client.post("/api/tasks", headers=h, json={"title": "自提", "board_id": world["board"].id})
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "pending_approval"
    assert r.json()["assignee"] is None


# --------------------------------------------------------------------------
# Full lifecycle: start -> submit -> review (approve & reject-rework)
# --------------------------------------------------------------------------


def _assigned_task(client, world):
    admin = auth_header(client, "admin", "pw")
    return client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "生命周期", "board_id": world["board"].id, "assignee_id": world["member"].id},
    ).json()


def test_full_lifecycle_approve(client, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)

    r = client.post(f"/api/tasks/{t['id']}/start", headers=member)
    assert r.status_code == 200 and r.json()["column_id"] == world["cols"]["doing"].id

    r = client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "完成了"})
    assert r.status_code == 200 and r.json()["column_id"] == world["cols"]["review"].id

    r = client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})
    assert r.status_code == 200 and r.json()["column_id"] == world["cols"]["done"].id

    # deliverable recorded
    detail = client.get(f"/api/tasks/{t['id']}", headers=admin).json()
    assert len(detail["deliverables"]) == 1
    assert detail["deliverables"][0]["note"] == "完成了"


def test_review_reject_rework(client, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "v1"})

    r = client.post(
        f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": False, "comment": "重做"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["column_id"] == world["cols"]["doing"].id
    assert body["is_rework"] is True

    # reject without comment is 400
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "v2"})
    bad = client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": False})
    assert bad.status_code == 400


def test_review_on_non_review_column_is_409(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)  # sits in start column
    r = client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})
    assert r.status_code == 409


def test_member_cannot_review(client, world):
    member = auth_header(client, "member", "pw")
    member2 = auth_header(client, "member2", "pw")
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "x"})
    r = client.post(f"/api/tasks/{t['id']}/review", headers=member2, json={"approve": True})
    assert r.status_code == 403


def test_member_can_only_start_own(client, world):
    member2 = auth_header(client, "member2", "pw")
    t = _assigned_task(client, world)  # assigned to member, not member2
    r = client.post(f"/api/tasks/{t['id']}/start", headers=member2)
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Move rules
# --------------------------------------------------------------------------


def test_member_cannot_move_into_done(client, world):
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)
    r = client.post(
        f"/api/tasks/{t['id']}/move", headers=member, json={"column_id": world["cols"]["done"].id}
    )
    assert r.status_code == 403


def test_member_can_move_own_non_done(client, world):
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)
    r = client.post(
        f"/api/tasks/{t['id']}/move", headers=member, json={"column_id": world["cols"]["doing"].id}
    )
    assert r.status_code == 200


def test_member_cannot_move_others_card(client, world):
    member2 = auth_header(client, "member2", "pw")
    t = _assigned_task(client, world)
    r = client.post(
        f"/api/tasks/{t['id']}/move", headers=member2, json={"column_id": world["cols"]["doing"].id}
    )
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Self-submit approve / decline
# --------------------------------------------------------------------------


def test_self_submit_approve(client, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = client.post(
        "/api/tasks", headers=member, json={"title": "自提通过", "board_id": world["board"].id}
    ).json()
    assert t["lifecycle"] == "pending_approval"

    r = client.post(
        f"/api/tasks/{t['id']}/approve",
        headers=admin,
        json={"approve": True, "assignee_id": world["member"].id},
    )
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "on_board"
    assert r.json()["column_id"] == world["cols"]["start"].id


def test_self_submit_decline(client, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = client.post(
        "/api/tasks", headers=member, json={"title": "自提拒绝", "board_id": world["board"].id}
    ).json()
    r = client.post(f"/api/tasks/{t['id']}/approve", headers=admin, json={"approve": False})
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "declined"


def test_approve_without_assignee_is_400(client, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = client.post(
        "/api/tasks", headers=member, json={"title": "x", "board_id": world["board"].id}
    ).json()
    r = client.post(f"/api/tasks/{t['id']}/approve", headers=admin, json={"approve": True})
    assert r.status_code == 400


# --------------------------------------------------------------------------
# Pool: apply + dispatch
# --------------------------------------------------------------------------


def test_pool_apply_and_dispatch(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")

    t = client.post("/api/tasks", headers=admin, json={"title": "池任务", "board_id": world["board"].id}).json()
    assert t["lifecycle"] == "open"

    # appears in pool for same-department member
    pool = client.get("/api/pool", headers=member).json()
    assert any(p["id"] == t["id"] for p in pool)

    # member applies
    r = client.post(f"/api/tasks/{t['id']}/apply", headers=member)
    assert r.status_code == 200 and r.json()["ok"] is True

    # task still in pool
    pool2 = client.get("/api/pool", headers=member).json()
    assert any(p["id"] == t["id"] for p in pool2)

    # admin sees applications
    apps = client.get(f"/api/tasks/{t['id']}/applications", headers=admin).json()
    assert len(apps) == 1 and apps[0]["applicant"]["id"] == world["member"].id

    # admin dispatches via assign
    r = client.post(
        f"/api/tasks/{t['id']}/assign", headers=admin, json={"assignee_id": world["member"].id}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["lifecycle"] == "on_board"
    assert body["column_id"] == world["cols"]["start"].id

    # gone from pool
    pool3 = client.get("/api/pool", headers=member).json()
    assert all(p["id"] != t["id"] for p in pool3)


def test_admin_cannot_apply(client, world):
    admin = auth_header(client, "admin", "pw")
    t = client.post("/api/tasks", headers=admin, json={"title": "p", "board_id": world["board"].id}).json()
    r = client.post(f"/api/tasks/{t['id']}/apply", headers=admin)
    assert r.status_code == 403


def test_pool_department_isolation(client, world):
    admin = auth_header(client, "admin", "pw")
    mkt_member = auth_header(client, "mkt_member", "pw")
    t = client.post("/api/tasks", headers=admin, json={"title": "研发池", "board_id": world["board"].id}).json()
    # market member is in a different department -> doesn't see it
    pool = client.get("/api/pool", headers=mkt_member).json()
    assert all(p["id"] != t["id"] for p in pool)


def test_member_can_view_pool_task_detail(client, world):
    """Regression: a member must be able to open the detail of an open pool
    task in their own department/board (to apply), but not a non-own on-board
    task, and not another department's pool task."""
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    mkt_member = auth_header(client, "mkt_member", "pw")

    pool_task = client.post(
        "/api/tasks", headers=admin, json={"title": "研发池任务", "board_id": world["board"].id}
    ).json()
    # member (same dept) can view the pool task detail
    assert client.get(f"/api/tasks/{pool_task['id']}", headers=member).status_code == 200
    # market member (other dept) cannot
    assert client.get(f"/api/tasks/{pool_task['id']}", headers=mkt_member).status_code == 403

    # a task assigned to member2 (on board) is NOT visible to member
    assigned = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "别人的任务", "board_id": world["board"].id, "assignee_id": world["member2"].id},
    ).json()
    assert assigned["lifecycle"] == "on_board"
    assert client.get(f"/api/tasks/{assigned['id']}", headers=member).status_code == 403


# --------------------------------------------------------------------------
# Cross-department assignment + reassign
# --------------------------------------------------------------------------


def test_cross_department_assign(client, world):
    admin = auth_header(client, "admin", "pw")
    # admin (研发) assigns task to a 市场 member -> allowed (collaboration)
    r = client.post(
        "/api/tasks",
        headers=admin,
        json={
            "title": "跨部门",
            "board_id": world["board"].id,
            "assignee_id": world["mkt_member"].id,
        },
    )
    assert r.status_code == 200
    assert r.json()["assignee"]["id"] == world["mkt_member"].id
    assert r.json()["lifecycle"] == "on_board"


def test_reassign_transfer(client, world):
    admin = auth_header(client, "admin", "pw")
    t = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "转派", "board_id": world["board"].id, "assignee_id": world["member"].id},
    ).json()
    r = client.post(
        f"/api/tasks/{t['id']}/assign", headers=admin, json={"assignee_id": world["member2"].id}
    )
    assert r.status_code == 200
    assert r.json()["assignee"]["id"] == world["member2"].id


def test_member_cannot_assign(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "x", "board_id": world["board"].id, "assignee_id": world["member"].id},
    ).json()
    r = client.post(f"/api/tasks/{t['id']}/assign", headers=member, json={"assignee_id": world["member2"].id})
    assert r.status_code == 403


# --------------------------------------------------------------------------
# Task list visibility scoping
# --------------------------------------------------------------------------


def test_member_only_sees_own_tasks(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    # task for member
    client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "给member", "board_id": world["board"].id, "assignee_id": world["member"].id},
    )
    # task for member2
    client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "给member2", "board_id": world["board"].id, "assignee_id": world["member2"].id},
    )
    tasks = client.get("/api/tasks", headers=member).json()
    titles = {t["title"] for t in tasks}
    assert "给member" in titles
    assert "给member2" not in titles


def test_tasks_filter_by_board(client, world):
    admin = auth_header(client, "admin", "pw")
    client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "f", "board_id": world["board"].id, "assignee_id": world["member"].id},
    )
    tasks = client.get(f"/api/tasks?board_id={world['board'].id}", headers=admin).json()
    assert len(tasks) >= 1
    assert all(t["board_id"] == world["board"].id for t in tasks)
