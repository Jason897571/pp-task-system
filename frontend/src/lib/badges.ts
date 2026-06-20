import type { ColumnKind } from '../api/types'

export function initial(fullName: string): string {
  return fullName ? fullName.slice(-1) : '?'
}

// Stable color from a name (Trello-ish palette) for avatars.
const AVATAR_COLORS = ['#579dff', '#22a06b', '#e2725b', '#9f8fef', '#fea362', '#f5cd47']
export function avatarColor(seed: string | number): string {
  const n = typeof seed === 'number' ? seed : seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

export type DueState = 'over' | 'soon' | 'done' | 'normal'

// Yellow near / red overdue / green done — per spec §7.3.
export function dueState(dueDate: string | null, columnKind: ColumnKind): DueState | null {
  if (!dueDate) return null
  if (columnKind === 'done') return 'done'
  const due = new Date(dueDate).getTime()
  const now = Date.now()
  const days = (due - now) / 86_400_000
  if (days < 0) return 'over'
  if (days <= 2) return 'soon'
  return 'normal'
}

export function dueLabel(dueDate: string): string {
  const d = new Date(dueDate)
  return d.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
