import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App as AntApp } from 'antd'
import { CardActions } from './CardActions'
import type { ColumnKind, TaskDetail, User } from '../api/types'

const noop = () => {}

function makeTask(over: Partial<TaskDetail>): TaskDetail {
  return {
    id: 1,
    title: 't',
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
    deleted_at: null,
    created_at: '',
    updated_at: '',
    tags: [],
    checklist_stats: { done: 0, total: 0 },
    deliverables: [],
    applications: [],
    checklists: [],
    attachments: [],
    comments: [],
    ...over,
  }
}

function renderActions(
  task: TaskDetail,
  columnKind: ColumnKind,
  me: Pick<User, 'id' | 'role'>,
  requiresReview = false,
) {
  return render(
    <AntApp>
      <CardActions
        task={task}
        columnKind={columnKind}
        requiresReview={requiresReview}
        me={me}
        onStart={noop}
        onSubmit={noop}
        onApply={noop}
        onReview={noop}
        onApprove={noop}
        onAssign={noop}
        onComment={noop}
      />
    </AntApp>,
  )
}

const member = { id: 1, role: 'member' as const }
const admin = { id: 9, role: 'admin' as const }

describe('CardActions rendering', () => {
  it('member sees 开始 in start column as assignee', () => {
    const task = makeTask({ assignee: { id: 1, full_name: 'M', role: 'member', department_id: 1 } })
    const { container } = renderActions(task, 'start', member)
    expect(container.querySelector('[data-action="start"]')).toBeInTheDocument()
    expect(container.querySelector('[data-action="review-approve"]')).not.toBeInTheDocument()
  })

  it('member sees no 开始 in start column when not assignee', () => {
    const task = makeTask({ assignee: { id: 2, full_name: 'O', role: 'member', department_id: 1 } })
    const { container } = renderActions(task, 'start', member)
    expect(container.querySelector('[data-action="start"]')).not.toBeInTheDocument()
    expect(screen.getByText('无可用动作')).toBeInTheDocument()
  })

  it('admin sees 审核 buttons only in a requires-review column', () => {
    const task = makeTask({})
    const { container } = renderActions(task, 'review', admin, true)
    expect(container.querySelector('[data-action="review-approve"]')).toBeInTheDocument()
    expect(container.querySelector('[data-action="review-reject"]')).toBeInTheDocument()
  })

  it('admin does not see 审核 in doing column', () => {
    const task = makeTask({})
    const { container } = renderActions(task, 'doing', admin)
    expect(container.querySelector('[data-action="review-approve"]')).not.toBeInTheDocument()
    // but still sees assign on any on-board card
    expect(container.querySelector('[data-action="assign-confirm"]')).toBeInTheDocument()
  })

  it('admin sees 分派 for open pool task', () => {
    const task = makeTask({ lifecycle: 'open', column_id: null })
    const { container } = renderActions(task, null, admin)
    expect(container.querySelector('[data-action="assign-confirm"]')).toBeInTheDocument()
    expect(container.querySelector('[data-action="review-approve"]')).not.toBeInTheDocument()
  })
})
