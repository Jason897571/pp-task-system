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


def test_board_member_visibility_restriction(client, world):
    sup = auth_header(client, "super", "pw")
    bid = world["board"].id
    # restrict board to member only (via the matrix endpoint)
    r = client.put(
        f"/api/boards/{bid}/member-visibility",
        headers=sup,
        json={"user_ids": [world["member"].id]},
    )
    assert r.status_code == 200

    # member can see it; member2 (not listed) cannot
    member = auth_header(client, "member", "pw")
    assert any(b["id"] == bid for b in client.get("/api/boards", headers=member).json())
    member2 = auth_header(client, "member2", "pw")
    assert all(b["id"] != bid for b in client.get("/api/boards", headers=member2).json())
    # super_admin always sees it
    assert any(b["id"] == bid for b in client.get("/api/boards", headers=sup).json())

    # clearing the allow-list makes it visible to all again
    client.put(f"/api/boards/{bid}/member-visibility", headers=sup, json={"user_ids": []})
    assert any(b["id"] == bid for b in client.get("/api/boards", headers=member2).json())


def test_visibility_matrix_requires_super(client, world):
    admin = auth_header(client, "admin", "pw")
    assert client.get("/api/boards/visibility-matrix", headers=admin).status_code == 403
    sup = auth_header(client, "super", "pw")
    m = client.get("/api/boards/visibility-matrix", headers=sup).json()
    assert "boards" in m and "users" in m and "visibility" in m
    # users are admins/members only (no super_admin row)
    assert all(u["role"] in ("admin", "member") for u in m["users"])


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


def test_delete_board_removes_cards(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    # new board + a task on it
    board = client.post("/api/boards", headers=sup, json={"name": "临时看板"}).json()
    task = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "临时任务", "board_id": board["id"], "assignee_id": world["member"].id},
    ).json()
    # delete the board
    r = client.delete(f"/api/boards/{board['id']}", headers=sup)
    assert r.status_code == 200 and r.json()["ok"] is True
    # board gone from list, and its task no longer fetchable
    boards = client.get("/api/boards", headers=sup).json()
    assert all(b["id"] != board["id"] for b in boards)
    assert client.get(f"/api/tasks/{task['id']}", headers=sup).status_code == 404


def test_delete_board_requires_super_admin(client, world):
    admin = auth_header(client, "admin", "pw")
    assert client.delete(f"/api/boards/{world['board'].id}", headers=admin).status_code == 403


def test_reorder_boards(client, world):
    sup = auth_header(client, "super", "pw")
    b2 = client.post("/api/boards", headers=sup, json={"name": "看板二"}).json()
    b3 = client.post("/api/boards", headers=sup, json={"name": "看板三"}).json()
    desired = [b3["id"], world["board"].id, b2["id"]]
    r = client.put("/api/boards/reorder", headers=sup, json={"board_ids": desired})
    assert r.status_code == 200
    # Archive board is auto-created and pinned last; compare only normal boards.
    order = [b["id"] for b in client.get("/api/boards", headers=sup).json() if not b["is_archive"]]
    assert order == desired
    # non-super forbidden
    member = auth_header(client, "member", "pw")
    assert client.put("/api/boards/reorder", headers=member, json={"board_ids": desired}).status_code == 403


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


def test_member_create_goes_on_board_assigned_self(client, world):
    # Members add tasks straight onto the board (assigned to themselves), no approval.
    h = auth_header(client, "member", "pw")
    r = client.post("/api/tasks", headers=h, json={"title": "自建", "board_id": world["board"].id})
    assert r.status_code == 200
    body = r.json()
    assert body["lifecycle"] == "on_board"
    assert body["assignee"]["id"] == world["member"].id
    assert body["column_id"] == world["cols"]["start"].id


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


# --------------------------------------------------------------------------
# Final-acceptance column + weekly archive + restore
# --------------------------------------------------------------------------


def test_final_column_archive_and_restore(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    done = world["cols"]["done"]

    # super marks the 已完成 column as the final-acceptance stage
    r = client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})
    assert r.status_code == 200 and r.json()["is_final"] is True

    # a card lands in the final column (admin assigns + drives it through review)
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "done"})
    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})

    # run the weekly sweep now
    r = client.post("/api/boards/archive-now", headers=sup)
    assert r.status_code == 200 and r.json()["archived"] == 1

    # the card now lives on the archive board
    boards = client.get("/api/boards", headers=sup).json()
    archive = next(b for b in boards if b["is_archive"])
    detail = client.get(f"/api/tasks/{t['id']}", headers=sup).json()
    assert detail["board_id"] == archive["id"]

    # admin restores it to another board's start column
    target = world["board"].id
    start_col = world["cols"]["start"].id
    r = client.post(
        f"/api/tasks/{t['id']}/move-to-board",
        headers=admin,
        json={"board_id": target, "column_id": start_col},
    )
    assert r.status_code == 200
    assert r.json()["board_id"] == target and r.json()["column_id"] == start_col


def test_only_one_final_column_per_board(client, world):
    sup = auth_header(client, "super", "pw")
    done = world["cols"]["done"]
    review = world["cols"]["review"]
    client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})
    client.put(f"/api/columns/{review.id}", headers=sup, json={"is_final": True})

    cols = client.get(f"/api/boards/{world['board'].id}/columns", headers=sup).json()
    finals = [c["id"] for c in cols if c["is_final"]]
    assert finals == [review.id]  # marking review cleared done


def test_member_cannot_restore_archived(client, world):
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)
    r = client.post(
        f"/api/tasks/{t['id']}/move-to-board",
        headers=member,
        json={"board_id": world["board"].id, "column_id": world["cols"]["start"].id},
    )
    assert r.status_code == 403


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


def _pending_task(db, world, title="待审批需求"):
    """Insert a pending-approval task directly. Members no longer create these via
    the API (they add straight to the board), but the approval endpoint still
    handles any legacy pending tasks, so it stays covered."""
    from app.models import Task

    t = Task(
        title=title,
        creator_id=world["member"].id,
        assignee_id=None,
        department_id=world["rnd"].id,
        board_id=world["board"].id,
        column_id=None,
        lifecycle="pending_approval",
    )
    db.add(t)
    db.commit()
    return t


def test_self_submit_approve(client, db, world):
    admin = auth_header(client, "admin", "pw")
    t = _pending_task(db, world, "自提通过")
    r = client.post(
        f"/api/tasks/{t.id}/approve",
        headers=admin,
        json={"approve": True, "assignee_id": world["member"].id},
    )
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "on_board"
    assert r.json()["column_id"] == world["cols"]["start"].id


def test_self_submit_decline(client, db, world):
    admin = auth_header(client, "admin", "pw")
    t = _pending_task(db, world, "自提拒绝")
    r = client.post(f"/api/tasks/{t.id}/approve", headers=admin, json={"approve": False})
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "declined"


def test_declined_task_goes_to_trash_and_notifies_creator(client, db, world):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    t = _pending_task(db, world, "被拒需求")

    r = client.post(f"/api/tasks/{t.id}/approve", headers=admin, json={"approve": False})
    assert r.status_code == 200
    assert r.json()["lifecycle"] == "declined"
    assert r.json()["deleted_at"] is not None

    # gone from the pending queue
    pending = client.get("/api/tasks?lifecycle=pending_approval", headers=admin).json()
    assert all(x["id"] != t.id for x in pending)
    # but recoverable from the recycle bin (not silently lost)
    trash = client.get("/api/trash", headers=admin).json()
    assert any(x["id"] == t.id for x in trash)
    # creator is notified their requirement was rejected
    notifs = client.get("/api/notifications", headers=member).json()
    assert any(n["type"] == "rejected" and "被拒需求" in n["message"] for n in notifs)


def test_restore_declined_task_returns_to_pending(client, db, world):
    admin = auth_header(client, "admin", "pw")
    t = _pending_task(db, world, "拒后恢复")
    client.post(f"/api/tasks/{t.id}/approve", headers=admin, json={"approve": False})

    r = client.post(f"/api/tasks/{t.id}/restore", headers=admin)
    assert r.status_code == 200
    # a restored rejected task must not vanish again -> back to the approval queue
    assert r.json()["deleted_at"] is None
    assert r.json()["lifecycle"] == "pending_approval"
    pending = client.get("/api/tasks?lifecycle=pending_approval", headers=admin).json()
    assert any(x["id"] == t.id for x in pending)


def test_approve_without_assignee_is_400(client, db, world):
    admin = auth_header(client, "admin", "pw")
    t = _pending_task(db, world, "x")
    r = client.post(f"/api/tasks/{t.id}/approve", headers=admin, json={"approve": True})
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
# Send an on-board task back to the pool (reverse of assign)
# --------------------------------------------------------------------------


def test_to_pool_returns_on_board_task(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "回池", "board_id": world["board"].id, "assignee_id": world["member"].id},
    ).json()
    assert t["lifecycle"] == "on_board"

    r = client.post(f"/api/tasks/{t['id']}/to-pool", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["lifecycle"] == "open"
    assert body["assignee"] is None
    assert body["column_id"] is None
    assert body["board_id"] == world["board"].id  # board kept

    # reappears in the pool
    pool = client.get("/api/pool", headers=member).json()
    assert any(p["id"] == t["id"] for p in pool)


def test_to_pool_rejects_non_on_board(client, world):
    admin = auth_header(client, "admin", "pw")
    t = client.post("/api/tasks", headers=admin, json={"title": "已在池", "board_id": world["board"].id}).json()
    assert t["lifecycle"] == "open"
    r = client.post(f"/api/tasks/{t['id']}/to-pool", headers=admin)
    assert r.status_code == 409


def test_member_cannot_to_pool(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = client.post(
        "/api/tasks",
        headers=admin,
        json={"title": "x", "board_id": world["board"].id, "assignee_id": world["member"].id},
    ).json()
    r = client.post(f"/api/tasks/{t['id']}/to-pool", headers=member)
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


# --------------------------------------------------------------------------
# Recycle bin (soft delete -> restore / purge / 30-day auto-purge)
# --------------------------------------------------------------------------


def test_delete_card_goes_to_trash_and_hides_from_board(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)

    r = client.delete(f"/api/tasks/{t['id']}", headers=admin)
    assert r.status_code == 200

    # gone from the board list
    tasks = client.get(f"/api/tasks?board_id={world['board'].id}", headers=admin).json()
    assert all(x["id"] != t["id"] for x in tasks)
    # detail 404s
    assert client.get(f"/api/tasks/{t['id']}", headers=admin).status_code == 404
    # shows in trash
    trash = client.get("/api/trash", headers=admin).json()
    assert any(x["id"] == t["id"] and x["deleted_at"] for x in trash)
    # members cannot delete or view trash
    assert client.delete(f"/api/tasks/{t['id']}", headers=member).status_code in (403, 404)
    assert client.get("/api/trash", headers=member).status_code == 403


def test_restore_card_from_trash(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    client.delete(f"/api/tasks/{t['id']}", headers=admin)

    r = client.post(f"/api/tasks/{t['id']}/restore", headers=admin)
    assert r.status_code == 200 and r.json()["deleted_at"] is None
    tasks = client.get(f"/api/tasks?board_id={world['board'].id}", headers=admin).json()
    assert any(x["id"] == t["id"] for x in tasks)
    assert client.get("/api/trash", headers=admin).json() == []


def test_purge_card_permanently(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    client.delete(f"/api/tasks/{t['id']}", headers=admin)

    r = client.delete(f"/api/tasks/{t['id']}/purge", headers=admin)
    assert r.status_code == 200
    assert client.get("/api/trash", headers=admin).json() == []
    # restore now impossible
    assert client.post(f"/api/tasks/{t['id']}/restore", headers=admin).status_code == 404


def test_auto_purge_expired_trash(client, world, db):
    from datetime import datetime, timedelta, timezone

    from app.models import Task
    from app.services import purge_expired_trash

    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    client.delete(f"/api/tasks/{t['id']}", headers=admin)

    # backdate deletion to 31 days ago, then run the purge sweep
    task = db.get(Task, t["id"])
    task.deleted_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=31)
    db.commit()

    purged = purge_expired_trash(db)
    db.commit()
    assert purged == 1
    assert client.get("/api/trash", headers=admin).json() == []


def test_archive_columns_are_per_board_and_track_rename(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")

    # drive a card to the final column, then archive
    client.put(f"/api/columns/{world['cols']['done'].id}", headers=sup, json={"is_final": True})
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "x"})
    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})
    client.post("/api/boards/archive-now", headers=sup)

    boards = client.get("/api/boards", headers=sup).json()
    archive = next(b for b in boards if b["is_archive"])
    src = next(b for b in boards if b["id"] == world["board"].id)
    src_name = src["name"]

    # the archive board has a column named after the source board, holding the card
    cols = client.get(f"/api/boards/{archive['id']}/columns", headers=sup).json()
    arch_col = next(c for c in cols if c["name"] == src_name)
    detail = client.get(f"/api/tasks/{t['id']}", headers=sup).json()
    assert detail["board_id"] == archive["id"]
    assert detail["column_id"] == arch_col["id"]

    # renaming the source board renames its archive column in lockstep
    client.put(f"/api/boards/{world['board'].id}", headers=sup, json={"name": "新看板名"})
    cols = client.get(f"/api/boards/{archive['id']}/columns", headers=sup).json()
    assert any(c["name"] == "新看板名" for c in cols)
    assert all(c["name"] != src_name for c in cols)


def test_admin_comment_notifies_assignee(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)  # assigned to member

    r = client.post(
        f"/api/tasks/{t['id']}/comment", headers=admin, json={"comment": "请补充测试用例"}
    )
    assert r.status_code == 200
    cid = r.json()["id"]

    notifs = client.get("/api/notifications", headers=member).json()
    assert any(n["type"] == "comment" and "请补充测试用例" in n["message"] for n in notifs)

    # admin can attach a file to the comment
    up = client.post(
        "/api/files/upload",
        headers=admin,
        files={"file": ("note.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        data={"owner_type": "comment", "owner_id": str(cid)},
    )
    assert up.status_code == 200

    # the comment + its attachment show on the card, visible to the assignee
    detail = client.get(f"/api/tasks/{t['id']}", headers=member).json()
    assert any(c["body"] == "请补充测试用例" for c in detail["comments"])
    assert detail["comments"][0]["author"]["full_name"]
    c = next(c for c in detail["comments"] if c["id"] == cid)
    assert len(c["attachments"]) == 1 and c["attachments"][0]["filename"] == "note.png"

    # empty comment rejected
    assert client.post(
        f"/api/tasks/{t['id']}/comment", headers=admin, json={"comment": "   "}
    ).status_code == 400

    # the assignee (a member) can comment; the creator (admin) is notified
    rm = client.post(
        f"/api/tasks/{t['id']}/comment", headers=member, json={"comment": "已修复，请复查"}
    )
    assert rm.status_code == 200
    admin_notifs = client.get("/api/notifications", headers=admin).json()
    assert any(n["type"] == "comment" and "已修复，请复查" in n["message"] for n in admin_notifs)

    # an uninvolved member cannot comment on a card they can't see
    member2 = auth_header(client, "member2", "pw")
    assert client.post(
        f"/api/tasks/{t['id']}/comment", headers=member2, json={"comment": "x"}
    ).status_code in (401, 403)


def test_duplicate_task_copies_requirement_only(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    src = client.post(
        "/api/tasks",
        headers=admin,
        json={
            "title": "原始需求",
            "board_id": world["board"].id,
            "assignee_id": world["member"].id,
            "priority": "high",
            "description": "做这个",
        },
    ).json()
    cl = client.post(
        f"/api/tasks/{src['id']}/checklists", headers=admin, json={"title": "步骤"}
    ).json()
    client.post(f"/api/checklists/{cl['id']}/items", headers=admin, json={"content": "第一步"})
    client.post(
        "/api/files/upload",
        headers=admin,
        files={"file": ("req.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        data={"owner_type": "task", "owner_id": str(src["id"])},
    )
    # a deliverable (产出) that must NOT be copied
    client.post(f"/api/tasks/{src['id']}/start", headers=member)
    client.post(f"/api/tasks/{src['id']}/submit", headers=member, json={"note": "做完了"})

    dup = client.post(
        f"/api/tasks/{src['id']}/duplicate",
        headers=admin,
        json={"assignee_id": world["member2"].id},
    )
    assert dup.status_code == 200
    new_id = dup.json()["id"]
    assert new_id != src["id"]
    assert dup.json()["assignee"]["id"] == world["member2"].id
    assert dup.json()["lifecycle"] == "on_board"
    assert dup.json()["priority"] == "high"

    detail = client.get(f"/api/tasks/{new_id}", headers=admin).json()
    assert detail["description"] == "做这个"
    assert len(detail["checklists"]) == 1
    assert detail["checklists"][0]["items"][0]["content"] == "第一步"
    assert detail["checklists"][0]["items"][0]["is_done"] is False
    assert len(detail["attachments"]) == 1 and detail["attachments"][0]["filename"] == "req.png"
    # 产出 side not copied
    assert detail["deliverables"] == []
    assert detail["comments"] == []
    # new card sits in the board's start column
    cols = client.get(f"/api/boards/{world['board'].id}/columns", headers=admin).json()
    start_col = next(c for c in cols if c["kind"] == "start")
    assert detail["column_id"] == start_col["id"]

    # members cannot duplicate (assigning to others is a manager action)
    assert client.post(
        f"/api/tasks/{src['id']}/duplicate", headers=member, json={"assignee_id": world["member"].id}
    ).status_code in (401, 403)


def test_export_weekly_buckets(client, db, world):
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    from app.models import Task

    sh = ZoneInfo("Asia/Shanghai")
    now_local = datetime.now(sh).replace(tzinfo=None)
    this_monday = now_local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=now_local.weekday()
    )
    cols = world["cols"]

    def mk(title, *, lifecycle, column_id, updated):
        t = Task(
            title=title,
            creator_id=world["member"].id,
            assignee_id=world["member"].id,
            department_id=world["rnd"].id,
            board_id=world["board"].id,
            column_id=column_id,
            lifecycle=lifecycle,
            created_at=updated,
            updated_at=updated,
        )
        db.add(t)
        db.flush()
        return t

    mk("本周完成", lifecycle="on_board", column_id=cols["done"].id, updated=this_monday + timedelta(days=1))
    mk("上周完成", lifecycle="on_board", column_id=cols["done"].id, updated=this_monday - timedelta(days=2))
    mk("很久以前完成", lifecycle="on_board", column_id=cols["done"].id, updated=this_monday - timedelta(days=30))
    mk("进行中", lifecycle="on_board", column_id=cols["doing"].id, updated=now_local)
    mk("待认领", lifecycle="open", column_id=None, updated=now_local)
    mk("待审批", lifecycle="pending_approval", column_id=None, updated=now_local)
    db.commit()

    super_h = auth_header(client, "super", "pw")
    r = client.get("/api/export/weekly", headers=super_h)
    assert r.status_code == 200
    data = r.json()

    this_done = {t["title"] for t in data["this_week_completed"]}
    last_done = {t["title"] for t in data["last_week_completed"]}
    snapshot = {t["title"] for t in data["in_progress_or_todo"]}

    assert this_done == {"本周完成"}
    assert last_done == {"上周完成"}
    assert snapshot == {"进行中", "待认领", "待审批"}
    # "很久以前完成" is completed but outside both weekly windows → in no bucket
    assert "很久以前完成" not in this_done | last_done | snapshot
    # completed entries carry a completion timestamp; counts mirror the lists
    assert all("completed_at" in t for t in data["this_week_completed"])
    assert data["counts"]["this_week_completed"] == 1

    # super-only
    assert client.get("/api/export/weekly", headers=auth_header(client, "admin", "pw")).status_code == 403


def test_task_links_symmetric(client, db, world):
    admin = auth_header(client, "admin", "pw")
    a = _assigned_task(client, world)
    b = _assigned_task(client, world)

    # link a -> b
    r = client.post(f"/api/tasks/{a['id']}/links", headers=admin, json={"linked_task_id": b["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == b["id"]
    assert "status" in r.json()

    # symmetric: visible from both cards
    da = client.get(f"/api/tasks/{a['id']}", headers=admin).json()
    db_ = client.get(f"/api/tasks/{b['id']}", headers=admin).json()
    assert [t["id"] for t in da["links"]] == [b["id"]]
    assert [t["id"] for t in db_["links"]] == [a["id"]]

    # cannot link to self / duplicate is idempotent
    assert client.post(
        f"/api/tasks/{a['id']}/links", headers=admin, json={"linked_task_id": a["id"]}
    ).status_code == 400
    again = client.post(f"/api/tasks/{a['id']}/links", headers=admin, json={"linked_task_id": b["id"]})
    assert again.status_code == 200
    assert len(client.get(f"/api/tasks/{a['id']}", headers=admin).json()["links"]) == 1

    # unlink from the other side removes it for both
    assert client.delete(f"/api/tasks/{b['id']}/links/{a['id']}", headers=admin).status_code == 200
    assert client.get(f"/api/tasks/{a['id']}", headers=admin).json()["links"] == []

    # a member who can't edit the card cannot link
    other = auth_header(client, "member2", "pw")
    assert client.post(
        f"/api/tasks/{a['id']}/links", headers=other, json={"linked_task_id": b["id"]}
    ).status_code in (401, 403)


# --------------------------------------------------------------------------
# Regression: reassigning a task must not make it vanish (bug: department_id
# not tracking the new assignee, so admin_can_touch_task loses dept-scope).
# --------------------------------------------------------------------------


def test_reassign_keeps_task_visible(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")  # 研发 admin

    # super assigns a task to the 研发 admin. Super has no department, so the
    # task is created with department_id = None (the real-world "orphan" case).
    t = client.post(
        "/api/tasks",
        headers=sup,
        json={
            "title": "鑫杰测试seedream4.5是否支持生成2张图",
            "board_id": world["board"].id,
            "assignee_id": world["admin"].id,
        },
    ).json()

    # admin sees it while it's assigned to them.
    before = {x["id"] for x in client.get("/api/tasks", headers=admin).json()}
    assert t["id"] in before

    # admin delegates it to a member in their own department.
    r = client.post(
        f"/api/tasks/{t['id']}/assign",
        headers=admin,
        json={"assignee_id": world["member"].id},
    )
    assert r.status_code == 200, r.text

    # The task must still be visible to the delegating admin (their department).
    after = {x["id"] for x in client.get("/api/tasks", headers=admin).json()}
    assert t["id"] in after, "reassigned task vanished from the admin's board"

    # ...and to the new assignee.
    member = auth_header(client, "member", "pw")
    mids = {x["id"] for x in client.get("/api/tasks", headers=member).json()}
    assert t["id"] in mids


# --------------------------------------------------------------------------
# Regression: a super_admin (no department) must not create a department-less
# pool task — it would be invisible in every department-scoped pool.
# --------------------------------------------------------------------------


def test_super_pool_task_requires_department(client, world):
    sup = auth_header(client, "super", "pw")
    # No assignee + no department -> would be an orphan pool task -> rejected.
    r = client.post(
        "/api/tasks",
        headers=sup,
        json={"title": "无部门池任务", "board_id": world["board"].id},
    )
    assert r.status_code == 400, r.text

    # With an explicit department it lands in that department's pool.
    r2 = client.post(
        "/api/tasks",
        headers=sup,
        json={
            "title": "有部门池任务",
            "board_id": world["board"].id,
            "department_id": world["rnd"].id,
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["lifecycle"] == "open"
    assert r2.json()["department_id"] == world["rnd"].id


# --------------------------------------------------------------------------
# archived_at drives the 归档看板 weekly view: set on sweep, cleared on restore.
# --------------------------------------------------------------------------


def test_archived_at_set_on_archive_and_cleared_on_restore(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    done = world["cols"]["done"]
    client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})

    # drive a card to the final column, then sweep into the archive
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "done"})
    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})

    # before archive: no archive time
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["archived_at"] is None

    client.post("/api/boards/archive-now", headers=sup)
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["archived_at"] is not None

    # restoring it off the archive board clears archived_at again
    client.post(
        f"/api/tasks/{t['id']}/move-to-board",
        headers=admin,
        json={"board_id": world["board"].id, "column_id": world["cols"]["start"].id},
    )
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["archived_at"] is None


def test_restore_to_origin_lands_in_final_column(client, world):
    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    done = world["cols"]["done"]
    client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})

    # drive a card to the final column, then archive it
    t = _assigned_task(client, world)
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "done"})
    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})
    client.post("/api/boards/archive-now", headers=sup)

    # one-click restore -> back on the origin board's final column, un-archived
    r = client.post(f"/api/tasks/{t['id']}/restore-to-origin", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["board_id"] == world["board"].id
    assert body["column_id"] == done.id
    assert body["archived_at"] is None

    # a non-archived card can't be "restored"
    assert (
        client.post(f"/api/tasks/{t['id']}/restore-to-origin", headers=admin).status_code == 409
    )


# --------------------------------------------------------------------------
# completed_at: stamped when a card enters an is_final column (口径 A).
# Overwrites on re-entry; not cleared when leaving. Only for statistics.
# --------------------------------------------------------------------------


def _drive_to_done(client, world, t):
    member = auth_header(client, "member", "pw")
    admin = auth_header(client, "admin", "pw")
    client.post(f"/api/tasks/{t['id']}/start", headers=member)
    client.post(f"/api/tasks/{t['id']}/submit", headers=member, json={"note": "done"})
    client.post(f"/api/tasks/{t['id']}/review", headers=admin, json={"approve": True})


def test_completed_at_set_when_entering_final_column(client, world):
    sup = auth_header(client, "super", "pw")
    done = world["cols"]["done"]
    client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})

    t = _assigned_task(client, world)
    # before completion: no completion time
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["completed_at"] is None

    _drive_to_done(client, world, t)  # review-approve lands the card in the final column
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["completed_at"] is not None


def test_completed_at_not_set_when_done_column_is_not_final(client, world):
    # 口径 A: only the is_final column stamps completion. A plain done column doesn't.
    sup = auth_header(client, "super", "pw")
    t = _assigned_task(client, world)
    _drive_to_done(client, world, t)  # done column is NOT marked is_final
    assert client.get(f"/api/tasks/{t['id']}", headers=sup).json()["completed_at"] is None


def test_completed_at_persists_on_leave_and_refreshes_on_reenter(client, db, world):
    from datetime import timedelta

    from app.models import Task

    sup = auth_header(client, "super", "pw")
    admin = auth_header(client, "admin", "pw")
    done = world["cols"]["done"]
    client.put(f"/api/columns/{done.id}", headers=sup, json={"is_final": True})

    t = _assigned_task(client, world)
    _drive_to_done(client, world, t)
    task = db.get(Task, t["id"])
    db.refresh(task)
    first = task.completed_at
    assert first is not None

    # backdate it so a fresh stamp is strictly newer
    task.completed_at = first - timedelta(days=5)
    db.commit()
    backdated = task.completed_at

    # move OUT of the final column -> completed_at is NOT cleared
    client.post(
        f"/api/tasks/{t['id']}/move", headers=admin, json={"column_id": world["cols"]["doing"].id}
    )
    db.refresh(task)
    assert task.completed_at == backdated

    # move BACK into the final column -> completed_at refreshes to now
    client.post(f"/api/tasks/{t['id']}/move", headers=admin, json={"column_id": done.id})
    db.refresh(task)
    assert task.completed_at > backdated


# --------------------------------------------------------------------------
# Manual "push to Feishu" button: managers only, best-effort (webhook stubbed).
# --------------------------------------------------------------------------


def test_push_feishu_manager_only(client, world):
    admin = auth_header(client, "admin", "pw")
    member = auth_header(client, "member", "pw")
    t = _assigned_task(client, world)

    # manager can push (webhook is disabled in tests -> just returns ok)
    r = client.post(f"/api/tasks/{t['id']}/push-feishu", headers=admin)
    assert r.status_code == 200 and r.json()["ok"] is True

    # a member cannot push
    assert client.post(f"/api/tasks/{t['id']}/push-feishu", headers=member).status_code == 403

    # missing task 404s
    assert client.post("/api/tasks/999999/push-feishu", headers=admin).status_code == 404


def test_push_feishu_works_without_assignee(client, world):
    # a pool (unassigned) task can still be pushed by a manager
    admin = auth_header(client, "admin", "pw")
    t = client.post(
        "/api/tasks", headers=admin, json={"title": "池任务", "board_id": world["board"].id}
    ).json()
    assert t["assignee"] is None
    r = client.post(f"/api/tasks/{t['id']}/push-feishu", headers=admin)
    assert r.status_code == 200 and r.json()["ok"] is True


def test_update_task_title(client, world):
    admin = auth_header(client, "admin", "pw")
    t = _assigned_task(client, world)
    r = client.put(f"/api/tasks/{t['id']}", headers=admin, json={"title": "改后的标题"})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "改后的标题"
    # a member who is neither manager nor assignee cannot edit the title
    other = auth_header(client, "member2", "pw")
    assert (
        client.put(f"/api/tasks/{t['id']}", headers=other, json={"title": "x"}).status_code == 403
    )
