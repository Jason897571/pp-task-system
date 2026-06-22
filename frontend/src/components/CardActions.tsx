import { useState } from 'react'
import { Button, Input, Modal, Select, App as AntApp } from 'antd'
import type { TaskDetail, User } from '../api/types'
import { visibleActions } from '../lib/actions'
import type { ActionKey } from '../lib/actions'

interface Props {
  task: TaskDetail
  columnKind: import('../api/types').ColumnKind
  requiresReview?: boolean
  me: Pick<User, 'id' | 'role'>
  // Candidate assignees for admin assign/approve (members + self). Optional.
  assignableUsers?: User[]
  busy?: boolean
  onStart: () => void
  onSubmit: (note: string, files: File[]) => void
  onApply: () => void
  onReview: (approve: boolean, comment?: string) => void
  onApprove: (approve: boolean, assigneeId?: number) => void
  onAssign: (assigneeId: number) => void
  onComment: (text: string) => void
}

const LABELS: Record<ActionKey, string> = {
  start: '▶ 开始',
  submit: '⬆ 提交产出',
  apply: '🙋 申请',
  review: '审核',
  approve: '审批',
  assign_pool: '分派',
  assign_board: '指派 / 转派',
}

// Renders the role+column-gated action buttons (spec §9). data-action attrs aid testing.
export function CardActions(props: Props) {
  const { task, columnKind, requiresReview, me, busy } = props
  const { message } = AntApp.useApp()
  const actions = visibleActions({ task, columnKind, requiresReview, me })

  const [reviewRejectOpen, setReviewRejectOpen] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [comment, setComment] = useState('')
  const [assignTarget, setAssignTarget] = useState<number | undefined>()

  if (actions.length === 0) {
    return <div style={{ color: 'var(--subtle)', fontSize: 13 }}>无可用动作</div>
  }

  const assignablePool = props.assignableUsers ?? []

  return (
    <div className="modal-action-grp">
      {actions.includes('start') && (
        <Button data-action="start" type="primary" block loading={busy} onClick={props.onStart}>
          {LABELS.start}
        </Button>
      )}

      {actions.includes('apply') && (
        <Button data-action="apply" type="primary" block loading={busy} onClick={props.onApply}>
          {LABELS.apply}
        </Button>
      )}

      {actions.includes('review') && (
        <>
          <Button
            data-action="review-approve"
            type="primary"
            block
            loading={busy}
            onClick={() => props.onReview(true)}
          >
            ✓ 审核通过
          </Button>
          <Button
            data-action="review-reject"
            danger
            block
            onClick={() => setReviewRejectOpen(true)}
          >
            ↩ 打回重做
          </Button>
          <Input.TextArea
            data-action="comment-input"
            rows={2}
            placeholder="给负责人留个评论（会发送到 ta 的通知）…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <Button
            data-action="comment-send"
            block
            loading={busy}
            disabled={!comment.trim()}
            onClick={() => {
              props.onComment(comment.trim())
              setComment('')
            }}
          >
            💬 发送评论
          </Button>
        </>
      )}

      {actions.includes('approve') && (
        <>
          <Select
            data-action="approve-assignee"
            placeholder="通过后指派给…"
            style={{ width: '100%' }}
            options={assignablePool.map((u) => ({ value: u.id, label: u.full_name }))}
            value={assignTarget}
            onChange={setAssignTarget}
          />
          <Button
            data-action="approve-accept"
            type="primary"
            block
            loading={busy}
            onClick={() => {
              if (!assignTarget) return message.warning('请选择指派人')
              props.onApprove(true, assignTarget)
            }}
          >
            ✓ 通过 + 指派
          </Button>
          <Button data-action="approve-reject" danger block onClick={() => props.onApprove(false)}>
            ✕ 拒绝
          </Button>
        </>
      )}

      {(actions.includes('assign_pool') || actions.includes('assign_board')) && (
        <>
          <Select
            data-action="assign-target"
            placeholder={actions.includes('assign_pool') ? '分派给…' : '指派 / 转派给…'}
            style={{ width: '100%' }}
            options={assignablePool.map((u) => ({ value: u.id, label: u.full_name }))}
            value={assignTarget}
            onChange={setAssignTarget}
          />
          <Button
            data-action="assign-confirm"
            type="primary"
            block
            loading={busy}
            onClick={() => {
              if (!assignTarget) return message.warning('请选择人员')
              props.onAssign(assignTarget)
            }}
          >
            {actions.includes('assign_pool') ? LABELS.assign_pool : LABELS.assign_board}
          </Button>
        </>
      )}

      <Modal
        title="打回重做"
        open={reviewRejectOpen}
        okText="打回"
        okButtonProps={{ danger: true }}
        confirmLoading={busy}
        onCancel={() => setReviewRejectOpen(false)}
        onOk={() => {
          props.onReview(false, reviewComment)
          setReviewRejectOpen(false)
          setReviewComment('')
        }}
      >
        <Input.TextArea
          rows={4}
          placeholder="打回原因"
          value={reviewComment}
          onChange={(e) => setReviewComment(e.target.value)}
        />
      </Modal>
    </div>
  )
}
