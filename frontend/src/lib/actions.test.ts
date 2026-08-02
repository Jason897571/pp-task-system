import { describe, expect, it } from 'vitest'
import { adjacentColumns, canDrag, canDropInto, isWorker, visibleActions } from './actions'
import type { ActionContext } from './actions'
import type { BoardColumn, Task } from '../api/types'

const member = { id: 1, role: 'member' as const }
const otherMember = { id: 2, role: 'member' as const }
const admin = { id: 9, role: 'admin' as const }
const superAdmin = { id: 99, role: 'super_admin' as const }

const person = (id: number) => ({
  id,
  full_name: 'X',
  role: 'member' as const,
  department_id: 1,
  avatar_attachment_id: null,
  card_color: null,
})

const onBoard = (
  assigneeId: number | null,
  collaboratorIds: number[] = [],
): ActionContext['task'] => ({
  lifecycle: 'on_board',
  assignee: assigneeId ? person(assigneeId) : null,
  collaborators: collaboratorIds.map(person),
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
        task: { lifecycle: 'open', assignee: null, collaborators: [] },
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
        task: { lifecycle: 'pending_approval', assignee: null, collaborators: [] },
        columnKind: null,
        me: admin,
      }),
    ).toEqual(['approve'])
  })

  it('sees 分派 for open pool tasks', () => {
    expect(
      visibleActions({
        task: { lifecycle: 'open', assignee: null, collaborators: [] },
        columnKind: null,
        me: admin,
      }),
    ).toEqual(['assign_pool'])
  })
})

describe('visibleActions — super_admin', () => {
  it('can send an on-board card back to the pool', () => {
    expect(visibleActions({ task: onBoard(1), columnKind: 'review', me: superAdmin })).toEqual([
      'to_pool',
    ])
  })
  it('can approve a member submission', () => {
    const pending: ActionContext['task'] = { lifecycle: 'pending_approval', assignee: null, collaborators: [] }
    expect(visibleActions({ task: pending, columnKind: null, me: superAdmin })).toEqual(['approve'])
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

describe('adjacentColumns — card ‹ / › arrows', () => {
  const col = (id: number, position: number, kind: BoardColumn['kind'], requires_review = false) =>
    ({ id, board_id: 1, name: `c${id}`, kind, position, is_final: false, requires_review }) as BoardColumn
  // start(1) → review(2, gate) → done(3). Out of order to prove sorting by position.
  const cols = [col(3, 3, 'done'), col(1, 1, 'start'), col(2, 2, 'review', true)]
  const task = (
    columnId: number | null,
    assigneeId: number | null,
  ): Pick<Task, 'assignee' | 'collaborators' | 'column_id'> => ({
    column_id: columnId,
    assignee: assigneeId ? onBoard(assigneeId).assignee : null,
    collaborators: [],
  })

  it('gives both neighbours in the middle column (admin bypasses the review gate)', () => {
    const { prev, next } = adjacentColumns(cols, task(2, 1), admin)
    expect(prev?.id).toBe(1)
    expect(next?.id).toBe(3)
  })
  it('hides the back arrow on the first column', () => {
    expect(adjacentColumns(cols, task(1, 1), member).prev).toBeNull()
    expect(adjacentColumns(cols, task(1, 1), member).next?.id).toBe(2)
  })
  it('member cannot step forward into done through the review gate', () => {
    const { prev, next } = adjacentColumns(cols, task(2, 1), member)
    expect(prev?.id).toBe(1)
    expect(next).toBeNull()
  })
  it('gives nothing for a card the member does not own', () => {
    expect(adjacentColumns(cols, task(2, 2), member)).toEqual({ prev: null, next: null })
  })
})

describe('collaborators', () => {
  it('sees 开始 in the start column as a collaborator', () => {
    expect(
      visibleActions({ task: onBoard(2, [1]), columnKind: 'start', me: member }),
    ).toEqual(['start'])
  })

  it('sees 提交 in the doing column as a collaborator', () => {
    expect(
      visibleActions({ task: onBoard(2, [1]), columnKind: 'doing', me: member }),
    ).toEqual(['submit'])
  })

  it('lets a collaborator drag the card', () => {
    expect(canDrag(onBoard(2, [1]), member)).toBe(true)
  })

  it('still blocks a member who is neither assignee nor collaborator', () => {
    expect(canDrag(onBoard(2, [3]), member)).toBe(false)
    expect(visibleActions({ task: onBoard(2, [3]), columnKind: 'start', me: member })).toEqual([])
  })

  it('isWorker covers assignee and collaborators only', () => {
    expect(isWorker(onBoard(1, [2]), 1)).toBe(true)
    expect(isWorker(onBoard(1, [2]), 2)).toBe(true)
    expect(isWorker(onBoard(1, [2]), 3)).toBe(false)
  })

  it('offers an out-of-scope admin collaborator worker actions only', () => {
    // can_manage=false: the card is visible because they collaborate on it, but
    // 指派/转派 · 放回需求池 would 403 (admin_can_touch_task is department-scoped).
    expect(
      visibleActions({
        task: onBoard(1, [9]),
        columnKind: 'doing',
        me: admin,
        canManage: false,
      }),
    ).toEqual(['submit'])
    // with scope, the same admin gets the manager toolbar
    expect(
      visibleActions({ task: onBoard(1, [9]), columnKind: 'doing', me: admin }),
    ).toEqual(['assign_board', 'to_pool'])
  })
})
