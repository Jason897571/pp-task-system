"""Unit tests for the Feishu task-assignment card builder (pure function)."""

from app.feishu import build_task_card


def _card(**over):
    kwargs = dict(
        header="📌 新任务指派",
        footer="指派人：李四",
        title="优化首页加载速度",
        priority="high",
        due_date="2026-07-20",
        description="把首屏 LCP 降到 2s 以内",
        assignee_open_id="ou_abc",
        assignee_name="张三",
    )
    kwargs.update(over)
    return build_task_card(**kwargs)


def _body(card):
    return card["elements"][0]["text"]["content"]


def test_card_has_header_title_and_priority_color():
    card = _card()
    assert card["header"]["title"]["content"] == "📌 新任务指派"
    assert card["header"]["template"] == "red"  # high -> red


def test_card_priority_maps_to_p_label_and_color():
    assert _card(priority="normal")["header"]["template"] == "blue"
    assert _card(priority="low")["header"]["template"] == "grey"
    assert "P0" in _body(_card(priority="high"))
    assert "P1" in _body(_card(priority="normal"))
    assert "P2" in _body(_card(priority="low"))


def test_card_body_contains_title_due_detail_and_footer():
    card = _card()
    body = _body(card)
    assert "优化首页加载速度" in body
    assert "2026-07-20" in body
    assert "把首屏 LCP 降到 2s 以内" in body
    # footer note element carries the operator line
    note = card["elements"][-1]
    assert "指派人：李四" in note["elements"][0]["content"]


def test_card_mentions_assignee_by_open_id():
    assert "<at id=ou_abc></at>" in _body(_card())


def test_card_falls_back_to_plain_at_when_no_open_id():
    body = _body(_card(assignee_open_id=None))
    assert "<at id=" not in body
    assert "@张三" in body


def test_card_omits_missing_due_and_detail_rows():
    body = _body(_card(due_date=None, description=None))
    assert "DDL" not in body
    assert "详情" not in body
    # title + priority still present
    assert "标题" in body and "紧急" in body


def test_card_truncates_long_detail():
    body = _body(_card(description="x" * 300))
    assert "…" in body
    assert "x" * 300 not in body
