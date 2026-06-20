// Role + column-kind gated action visibility. This is the spec's key concern (§9)
// and the table under "角色动作显隐" in API_CONTRACT.md. Tested directly.
import type { ColumnKind, Role, Task, User } from '../api/types'

export type ActionKey =
  | 'start' // member: start-kind & is assignee
  | 'submit' // member: doing-kind & is assignee
  | 'apply' // member: open (pool)
  | 'review' // admin: review-kind
  | 'approve' // admin: pending_approval
  | 'assign_pool' // admin: open (pool) — 分派
  | 'assign_board' // admin: any on-board card — 指派/转派

export interface ActionContext {
  task: Pick<Task, 'lifecycle' | 'assignee'>
  columnKind: ColumnKind // kind of the task's current column (null if not on board)
  me: Pick<User, 'id' | 'role'>
}

const isAssignee = (task: ActionContext['task'], meId: number) =>
  task.assignee?.id === meId

export function visibleActions({ task, columnKind, me }: ActionContext): ActionKey[] {
  const actions: ActionKey[] = []
  const role: Role = me.role

  if (role === 'member') {
    if (task.lifecycle === 'open') actions.push('apply')
    if (task.lifecycle === 'on_board' && isAssignee(task, me.id)) {
      if (columnKind === 'start') actions.push('start')
      if (columnKind === 'doing') actions.push('submit')
    }
    return actions
  }

  if (role === 'admin') {
    if (task.lifecycle === 'open') actions.push('assign_pool')
    if (task.lifecycle === 'pending_approval') actions.push('approve')
    if (task.lifecycle === 'on_board') {
      if (columnKind === 'review') actions.push('review')
      actions.push('assign_board') // 指派/转派 on any on-board card
    }
    return actions
  }

  // super_admin: no card-flow action buttons (workflow editing lives in column headers).
  return actions
}

// Client-side drag rule (mirrors backend): member only drags own cards,
// nobody drags directly into a done-kind column (completion must pass review).
export function canDrag(
  task: Pick<Task, 'assignee'>,
  me: Pick<User, 'id' | 'role'>,
): boolean {
  if (me.role === 'member') return task.assignee?.id === me.id
  return true // admin / super_admin
}

export function canDropInto(targetKind: ColumnKind): boolean {
  return targetKind !== 'done'
}
