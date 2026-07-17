import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UrgencyMatrix } from './UrgencyMatrix'
import { nowTZ } from '../lib/tz'
import type { Task } from '../api/types'

function mk(id: number, priority: Task['priority'], due: string | null): Task {
  return {
    id,
    title: `任务${id}`,
    description: '',
    creator: { id: 9, full_name: 'A', role: 'admin', department_id: 1, avatar_attachment_id: null, card_color: null },
    assignee: null,
    department_id: 1,
    board_id: 1,
    column_id: 10,
    lifecycle: 'on_board',
    is_rework: false,
    priority,
    is_mandatory: false,
    due_date: due,
    deleted_at: null,
    archived_at: null,
    completed_at: null,
    created_at: '2026-06-01T00:00:00+08:00',
    updated_at: '2026-06-01T00:00:00+08:00',
    tags: [],
    checklist_stats: { done: 0, total: 0 },
  } as Task
}

describe('UrgencyMatrix', () => {
  // Build due dates relative to "now" in China time so the test is date-independent.
  const today = nowTZ().startOf('day')
  const at = (d: number) => today.add(d, 'day').hour(9).toDate().toISOString()

  it('lays tasks out on day columns by China-time DDL, with 逾期/今天/无期限', () => {
    render(
      <UrgencyMatrix
        tasks={[
          mk(101, 'high', at(-2)), // overdue
          mk(102, 'high', at(0)), // today
          mk(103, 'normal', at(3)), // +3 days
          mk(104, 'low', null), // no ddl
        ]}
        onOpen={() => {}}
      />,
    )
    // a "今天" day column header, plus 已逾期 and 无期限 buckets
    expect(screen.getByText('今天')).toBeTruthy()
    expect(screen.getByText('已逾期')).toBeTruthy()
    expect(screen.getByText('无期限')).toBeTruthy()
    // the overdue chip shows how overdue it is; the +3 chip shows its date
    expect(screen.getByText('逾期2天')).toBeTruthy()
    expect(screen.getAllByText(today.add(3, 'day').format('M/D')).length).toBeGreaterThan(0)
    // every task id is rendered
    for (const id of [101, 102, 103, 104]) {
      expect(screen.getByText(`#${id}`)).toBeTruthy()
    }
  })
})
