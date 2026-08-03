import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CardFront } from './TaskCard'
import type { Task } from '../api/types'

function makeTask(over: Partial<Task>): Task {
  return {
    id: 1,
    title: '写文档',
    description: '',
    creator: { id: 9, full_name: 'A', role: 'admin', department_id: 1, avatar_attachment_id: null, card_color: null },
    assignee: null,
    collaborators: [],
    department_id: 1,
    board_id: 1,
    column_id: 10,
    lifecycle: 'on_board',
    is_rework: false,
    priority: 'normal',
    is_mandatory: false,
    due_date: null,
    deleted_at: null,
    archived_at: null,
    completed_at: null,
    created_at: '',
    updated_at: '',
    tags: [],
    checklist_stats: { done: 0, total: 0 },
    ...over,
  }
}

const person = (id: number, name: string) => ({
  id,
  full_name: name,
  role: 'member' as const,
  department_id: 1,
  avatar_attachment_id: null,
  card_color: null,
})

describe('CardFront checklist badge', () => {
  it('renders 2/5 progress (not green) when partially done', () => {
    const task = makeTask({ checklist_stats: { done: 2, total: 5 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('☑ 2/5')).toBeInTheDocument()
    const chip = container.querySelector('.mchip.cl')
    expect(chip).toBeInTheDocument()
    expect(chip?.classList.contains('cl-done')).toBe(false)
  })

  it('renders green when all items done', () => {
    const task = makeTask({ checklist_stats: { done: 4, total: 4 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('☑ 4/4')).toBeInTheDocument()
    expect(container.querySelector('.mchip.cl.cl-done')).toBeInTheDocument()
  })

  it('hides the badge when there are no checklist items', () => {
    const task = makeTask({ checklist_stats: { done: 0, total: 0 } })
    const { container } = render(<CardFront task={task} columnKind="doing" />)
    expect(container.querySelector('.mchip.cl')).not.toBeInTheDocument()
  })
})

describe('CardFront collaborators', () => {
  it('renders an avatar for each collaborator next to the assignee', () => {
    const task = makeTask({
      assignee: person(1, '张三'),
      collaborators: [person(2, '李四'), person(3, '王五')],
    })
    render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByTitle('协作人：李四')).toBeInTheDocument()
    expect(screen.getByTitle('协作人：王五')).toBeInTheDocument()
  })

  it('collapses more than three collaborators into a +N badge', () => {
    const task = makeTask({
      assignee: person(1, '张三'),
      collaborators: [2, 3, 4, 5, 6].map((id) => person(id, `协作${id}`)),
    })
    render(<CardFront task={task} columnKind="doing" />)
    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})
