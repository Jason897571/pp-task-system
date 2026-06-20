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
    ? { id: assigneeId, full_name: 'X', role: 'member', department_id: 1 }
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
  it('sees 审核 only in review column (plus assign on board)', () => {
    const a = visibleActions({ task: onBoard(1), columnKind: 'review', me: admin })
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
  it('has no card-flow action buttons', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'review', me: superAdmin })).toEqual([])
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
  it('nobody can drop into a done column', () => {
    expect(canDropInto('done')).toBe(false)
    expect(canDropInto('doing')).toBe(true)
    expect(canDropInto(null)).toBe(true)
  })
})
