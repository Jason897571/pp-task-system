// Role + column-kind gated action visibility. This is the spec's key concern (§9)
// and the table under "角色动作显隐" in API_CONTRACT.md. Tested directly.
import type { BoardColumn, ColumnKind, Role, Task, User } from '../api/types'

export type ActionKey =
  | 'start' // member: start-kind & is assignee
  | 'submit' // member: doing-kind & is assignee
  | 'apply' // member: open (pool)
  | 'review' // admin: review-kind
  | 'approve' // admin: pending_approval
  | 'assign_pool' // admin: open (pool) — 分派
  | 'assign_board' // admin: any on-board card — 指派/转派
  | 'to_pool' // admin/super: on-board card → 放回需求池

export interface ActionContext {
  task: Pick<Task, 'lifecycle' | 'assignee' | 'collaborators'>
  columnKind: ColumnKind // kind of the task's current column (null if not on board)
  requiresReview?: boolean // task's current column is the board's review gate
  me: Pick<User, 'id' | 'role'>
}

// Who may work on a card: the assignee (owner) or any collaborator. Mirrors the
// backend's services.is_task_worker.
export function isWorker(
  task: Pick<Task, 'assignee' | 'collaborators'>,
  meId: number,
): boolean {
  if (task.assignee?.id === meId) return true
  return task.collaborators.some((c) => c.id === meId)
}

export function visibleActions({ task, columnKind, requiresReview, me }: ActionContext): ActionKey[] {
  const actions: ActionKey[] = []
  const role: Role = me.role

  if (role === 'member') {
    if (task.lifecycle === 'open') actions.push('apply')
    if (task.lifecycle === 'on_board' && isWorker(task, me.id)) {
      if (columnKind === 'start') actions.push('start')
      if (columnKind === 'doing') actions.push('submit')
    }
    return actions
  }

  if (role === 'admin') {
    if (task.lifecycle === 'open') actions.push('assign_pool')
    if (task.lifecycle === 'pending_approval') actions.push('approve')
    if (task.lifecycle === 'on_board') {
      if (requiresReview) actions.push('review')
      actions.push('assign_board') // 指派/转派 on any on-board card
      actions.push('to_pool') // 放回需求池
    }
    return actions
  }

  // super_admin: workflow editing lives in column headers. Card-flow actions are
  // approving a member's submission and sending an on-board task back to the pool.
  if (task.lifecycle === 'pending_approval') actions.push('approve')
  if (task.lifecycle === 'on_board') actions.push('to_pool')
  return actions
}

// Client-side drag rule (mirrors backend): member only drags own cards,
// nobody drags directly into a done-kind column (completion must pass review).
export function canDrag(
  task: Pick<Task, 'assignee' | 'collaborators'>,
  me: Pick<User, 'id' | 'role'>,
): boolean {
  if (me.role === 'member') return isWorker(task, me.id)
  return true // admin / super_admin
}

// Drag-drop rule. Completion must pass review ONLY when the board has a review
// gate; otherwise cards move freely. Admin/super always move anywhere.
export function canDropInto(
  target: Pick<BoardColumn, 'kind' | 'requires_review'>,
  opts: { role: Role; boardHasReview: boolean },
): { ok: boolean; reason?: string } {
  if (opts.role !== 'member') return { ok: true }
  if (target.kind === 'done' && opts.boardHasReview) {
    return { ok: false, reason: '需经审核后才能完成' }
  }
  return { ok: true }
}

// Adjacent columns a card may be moved into by the ‹ / › card arrows — the same
// rules as drag: only movable cards (member: own only), and drop must be allowed
// (member can't step into a done column when the board has a review gate). A null
// side means "no button" (edge of board or not permitted).
export function adjacentColumns(
  columns: BoardColumn[],
  task: Pick<Task, 'assignee' | 'collaborators' | 'column_id'>,
  me: Pick<User, 'id' | 'role'>,
): { prev: BoardColumn | null; next: BoardColumn | null } {
  if (!canDrag(task, me) || task.column_id == null) return { prev: null, next: null }
  const sorted = [...columns].sort((a, b) => a.position - b.position)
  const idx = sorted.findIndex((c) => c.id === task.column_id)
  if (idx < 0) return { prev: null, next: null }
  const boardHasReview = sorted.some((c) => c.requires_review)
  const ok = (c: BoardColumn | undefined) =>
    c && canDropInto(c, { role: me.role, boardHasReview }).ok ? c : null
  return { prev: ok(sorted[idx - 1]), next: ok(sorted[idx + 1]) }
}
