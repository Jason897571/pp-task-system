import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardFront } from './TaskCard'
import { TAG_COLORS } from '../lib/badges'
import type { Task } from '../api/types'

function makeTask(over: Partial<Task>): Task {
  return {
    id: 1,
    title: '写文档',
    description: '',
    creator: { id: 9, full_name: 'A', role: 'admin', department_id: 1 },
    assignee: null,
    department_id: 1,
    board_id: 1,
    column_id: 10,
    lifecycle: 'on_board',
    is_rework: false,
    priority: 'normal',
    is_mandatory: false,
    due_date: null,
    created_at: '',
    updated_at: '',
    tags: [],
    checklist_stats: { done: 0, total: 0 },
    ...over,
  }
}

describe('CardFront checklist badge', () => {
  it('renders 2/5 progress (not green) when partially done', () => {
    const task = makeTask({ checklist_stats: { done: 2, total: 5 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('☑ 2/5')).toBeInTheDocument()
    const badge = container.querySelector('.badge.checklist')
    expect(badge).toBeInTheDocument()
    expect(badge?.classList.contains('done')).toBe(false)
  })

  it('renders green when all items done', () => {
    const task = makeTask({ checklist_stats: { done: 4, total: 4 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('☑ 4/4')).toBeInTheDocument()
    expect(container.querySelector('.badge.checklist.done')).toBeInTheDocument()
  })

  it('hides the badge when there are no checklist items', () => {
    const task = makeTask({ checklist_stats: { done: 0, total: 0 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(container.querySelector('.badge.checklist')).not.toBeInTheDocument()
  })
})

describe('CardFront tag color bars', () => {
  it('renders a colored bar per tag using the palette color', () => {
    const task = makeTask({
      tags: [
        { id: 1, name: '紧急', color: 'red' },
        { id: 2, name: '后端', color: 'blue' },
      ],
    })
    const { container } = render(<CardFront task={task} columnKind="start" />)
    const tags = container.querySelectorAll('.card-tag')
    expect(tags).toHaveLength(2)
    expect(screen.getByText('紧急')).toBeInTheDocument()
    expect((tags[0] as HTMLElement).style.background).toBe(hexToRgb(TAG_COLORS.red))
    expect((tags[1] as HTMLElement).style.background).toBe(hexToRgb(TAG_COLORS.blue))
  })

  it('renders no tag container when there are no tags', () => {
    const task = makeTask({ tags: [] })
    const { container } = render(<CardFront task={task} columnKind="start" />)
    expect(container.querySelector('.card-tags')).not.toBeInTheDocument()
  })
})

// jsdom normalizes inline style colors to rgb(); convert the palette hex for comparison.
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
