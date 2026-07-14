import { describe, expect, it } from 'vitest'
import { groupByWeek } from './weeks'
import type { Task } from '../api/types'

function task(id: number, archived_at: string | null): Task {
  return {
    id,
    title: `T${id}`,
    description: "",
    creator: { id: 1, full_name: 'C', role: 'admin', department_id: 1, avatar_attachment_id: null, card_color: null },
    assignee: null,
    department_id: 1,
    board_id: 9,
    column_id: 1,
    lifecycle: 'on_board',
    is_rework: false,
    priority: 'normal',
    is_mandatory: false,
    due_date: null,
    deleted_at: null,
    archived_at,
    completed_at: null,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
    tags: [],
    checklist_stats: { done: 0, total: 0 },
  } as Task
}

describe('groupByWeek', () => {
  // Reference "now" inside the week of Mon 2026-06-29 .. Sun 2026-07-05.
  const now = new Date(2026, 6, 2) // 2026-07-02 (Thu)

  it('buckets tasks into Monday-based weeks, newest first', () => {
    const groups = groupByWeek(
      [
        task(1, '2026-07-01T09:00:00'), // this week (Mon 06-29)
        task(2, '2026-06-24T10:00:00'), // prev week (Mon 06-22)
        task(3, '2026-06-23T10:00:00'), // same prev week
      ],
      now,
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-06-29', '2026-06-22'])
    expect(groups[0].isCurrent).toBe(true)
    expect(groups[0].label).toBe('06-29 ~ 07-05')
    expect(groups[1].tasks.map((t) => t.id)).toEqual([2, 3]) // both in prev week
  })

  it('sorts cards within a week newest-archived first', () => {
    const groups = groupByWeek(
      [task(1, '2026-06-23T08:00:00'), task(2, '2026-06-25T08:00:00')],
      now,
    )
    expect(groups[0].tasks.map((t) => t.id)).toEqual([2, 1])
  })

  it('collects undated cards into a trailing 更早 bucket', () => {
    const groups = groupByWeek([task(1, '2026-07-01T09:00:00'), task(2, null)], now)
    expect(groups[groups.length - 1]).toMatchObject({ key: 'earlier', label: '更早' })
    expect(groups[groups.length - 1].tasks.map((t) => t.id)).toEqual([2])
  })
})
