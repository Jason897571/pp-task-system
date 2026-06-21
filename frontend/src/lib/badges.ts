import type { ColumnKind, TagColor } from '../api/types'

// 9-color label palette (spec §标签). Keys match the backend `color` field.
export const TAG_COLORS: Record<TagColor, string> = {
  green: '#4bce97',
  yellow: '#f5cd47',
  orange: '#fea362',
  red: '#f87168',
  purple: '#9f8fef',
  blue: '#579dff',
  sky: '#6cc3e0',
  pink: '#e774bb',
  gray: '#8c9bab',
}

export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as TagColor[]

// Priority shown as P0 (urgent) / P1 / P2, mapped to the stored low/normal/high.
export const PRIORITY_LABEL: Record<string, string> = { high: 'P0', normal: 'P1', low: 'P2' }
export const PRIORITY_OPTIONS = [
  { value: 'high', label: 'P0' },
  { value: 'normal', label: 'P1' },
  { value: 'low', label: 'P2' },
]

export function initial(fullName: string): string {
  if (!fullName) return '?'
  // Latin names → first letter uppercased; CJK names → surname (first char).
  return /^[a-zA-Z]/.test(fullName) ? fullName[0].toUpperCase() : fullName[0]
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
