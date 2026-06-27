import { describe, expect, it } from 'vitest'
import { canDrag, canDropInto, visibleActions } from './actions'
import type { ActionContext } from './actions'

const member = { id: 1, role: 'member' as const }
const otherMember = { id: 2, role: 'member' as const }
const admin = { id: 9, role: 'admin' as const }
const superAdmin = { id: 99, role: 'super_admin' as const }

const onBoard = (assigneeId: number | null): ActionContext['task'] => ({
  lifecycle: 'on_board',
  assignee: assigneeId
    ? { id: assigneeId, full_name: 'X', role: 'member', department_id: 1, avatar_attachment_id: null, card_color: null }
    : null,
})

describe('visibleActions — member', () => {
  it('sees 开始 only in start column as assignee', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'start', me: member })).toEqual(['start'])
  })

  it('does NOT see 开始 in start column when not the assignee', () => {
    expect(visibleActions({ task: onBoard(2), columnKind: 'start', me: member })).toEqual([])
  })

  it('sees 提交产出 only in doing column as assignee', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'doing', me: member })).toEqual(['submit'])
  })

  it('sees 申请 for open pool tasks', () => {
    expect(
      visibleActions({
        task: { lifecycle: 'open', assignee: null },
        columnKind: null,
        me: member,
      }),
    ).toEqual(['apply'])
  })

  it('sees nothing in review column', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'review', me: member })).toEqual([])
  })
})

describe('visibleActions — admin', () => {
  it('sees 审核 only in a requires-review column (plus assign on board)', () => {
    const a = visibleActions({ task: onBoard(1), columnKind: 'review', requiresReview: true, me: admin })
    expect(a).toContain('review')
    expect(a).toContain('assign_board')
  })

  it('does NOT see 审核 in start column', () => {
    const a = visibleActions({ task: onBoard(1), columnKind: 'start', me: admin })
    expect(a).not.toContain('review')
    expect(a).toContain('assign_board')
  })

  it('sees 审批 for pending_approval tasks', () => {
    expect(
      visibleActions({
        task: { lifecycle: 'pending_approval', assignee: null },
        columnKind: null,
        me: admin,
      }),
    ).toEqual(['approve'])
  })

  it('sees 分派 for open pool tasks', () => {
    expect(
      visibleActions({
        task: { lifecycle: 'open', assignee: null },
        columnKind: null,
        me: admin,
      }),
    ).toEqual(['assign_pool'])
  })
})

describe('visibleActions — super_admin', () => {
  it('can send an on-board card back to the pool, nothing else', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'review', me: superAdmin })).toEqual([
      'to_pool',
    ])
  })
})

describe('drag rules', () => {
  it('member can drag own card only', () => {
    expect(canDrag(onBoard(1), member)).toBe(true)
    expect(canDrag(onBoard(1), otherMember)).toBe(false)
  })
  it('admin can drag any card', () => {
    expect(canDrag(onBoard(1), admin)).toBe(true)
  })
  it('member cannot drop into done when the board has a review gate', () => {
    const done = { kind: 'done' as const, requires_review: false }
    const doing = { kind: 'doing' as const, requires_review: false }
    expect(canDropInto(done, { role: 'member', boardHasReview: true }).ok).toBe(false)
    // no review gate → free to complete
    expect(canDropInto(done, { role: 'member', boardHasReview: false }).ok).toBe(true)
    expect(canDropInto(doing, { role: 'member', boardHasReview: true }).ok).toBe(true)
    // admin moves anywhere
    expect(canDropInto(done, { role: 'admin', boardHasReview: true }).ok).toBe(true)
  })
})
