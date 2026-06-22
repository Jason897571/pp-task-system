import { useState } from 'react'
import { Button, Input, Modal, Popconfirm, Select, Upload, App as AntApp } from 'antd'
import type { UploadFile } from 'antd'
import type { TaskDetail, User } from '../api/types'
import { visibleActions } from '../lib/actions'

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
  onComment: (text: string, files: File[]) => void
  onDelete?: () => void
}

type Pane = null | 'comment' | 'assign' | 'approve'

// Role+column-gated actions. Members get a single primary button; managers get a
// compact toolbar (✓通过 ↩打回 ┃ 💬评论 👤指派 🗑) with click-to-expand panes.
export function CardActions(props: Props) {
  const { task, columnKind, requiresReview, me, busy, onDelete } = props
  const { message } = AntApp.useApp()
  const actions = visibleActions({ task, columnKind, requiresReview, me })
  const assignablePool = props.assignableUsers ?? []

  const hasReview = actions.includes('review')
  const hasApprove = actions.includes('approve')
  const hasAssign = actions.includes('assign_pool') || actions.includes('assign_board')
  const hasToolbar = hasReview || hasApprove || hasAssign || !!onDelete

  // The sole action of a context opens expanded; review's primary keys stay inline.
  const initialPane: Pane = hasApprove ? 'approve' : hasAssign && !hasReview ? 'assign' : null

  const [pane, setPane] = useState<Pane>(initialPane)
  const [reviewRejectOpen, setReviewRejectOpen] = useState(false)
  const [reviewComment, setReviewComment] = useState('')
  const [comment, setComment] = useState('')
  const [commentFiles, setCommentFiles] = useState<UploadFile[]>([])
  const [assignTarget, setAssignTarget] = useState<number | undefined>()

  const toggle = (p: Exclude<Pane, null>) => setPane(pane === p ? null : p)

  // ---- members / no-toolbar contexts: single primary button ----
  if (!hasToolbar) {
    return (
      <div className="modal-action-grp">
        {actions.includes('start') && (
          <Button data-action="start" type="primary" block loading={busy} onClick={props.onStart}>
            ▶ 开始
          </Button>
        )}
        {actions.includes('apply') && (
          <Button data-action="apply" type="primary" block loading={busy} onClick={props.onApply}>
            🙋 申请
          </Button>
        )}
        {actions.length === 0 && (
          <div style={{ color: 'var(--subtle)', fontSize: 13 }}>无可用动作</div>
        )}
      </div>
    )
  }

  const sendComment = () => {
    const files = commentFiles.map((f) => f.originFileObj as File).filter(Boolean)
    props.onComment(comment.trim(), files)
    setComment('')
    setCommentFiles([])
  }

  return (
    <div className="cm-actionbar">
      <div className="cm-toolbar">
        {hasReview && (
          <>
            <button
              data-action="review-approve"
              className="tbtn primary"
              disabled={busy}
              onClick={() => props.onReview(true)}
            >
              ✓ 通过
            </button>
            <button
              data-action="review-reject"
              className="tbtn danger"
              onClick={() => setReviewRejectOpen(true)}
            >
              ↩ 打回
            </button>
            <span className="tdiv" />
            <button
              className={`tbtn ${pane === 'comment' ? 'active' : ''}`}
              onClick={() => toggle('comment')}
            >
              💬 评论
            </button>
          </>
        )}

        {hasApprove && (
          <button
            className={`tbtn ${pane === 'approve' ? 'active' : ''}`}
            onClick={() => toggle('approve')}
          >
            ✓ 审批
          </button>
        )}

        {hasAssign && (
          <button
            className={`tbtn ${pane === 'assign' ? 'active' : ''}`}
            onClick={() => toggle('assign')}
          >
            👤 {actions.includes('assign_pool') ? '分派' : '指派 / 转派'}
          </button>
        )}

        {onDelete && (
          <>
            <span className="tspacer" />
            <Popconfirm
              title="删除卡片？"
              description="卡片将移入回收箱，保留 30 天，可随时恢复。"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={onDelete}
            >
              <button className="tbtn icon danger" title="删除卡片">
                🗑
              </button>
            </Popconfirm>
          </>
        )}
      </div>

      {pane === 'comment' && (
        <div className="cm-pane">
          <Input.TextArea
            data-action="comment-input"
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="给负责人留个评论（会发送到 ta 的通知，可附文件）…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="cm-pane-foot">
            <Upload
              fileList={commentFiles}
              beforeUpload={() => false}
              onChange={({ fileList }) => setCommentFiles(fileList)}
              multiple
            >
              <Button size="small">📎 附件</Button>
            </Upload>
            <Button
              data-action="comment-send"
              type="primary"
              size="small"
              loading={busy}
              disabled={!comment.trim()}
              onClick={sendComment}
            >
              💬 发送评论
            </Button>
          </div>
        </div>
      )}

      {pane === 'assign' && (
        <div className="cm-pane">
          <div className="cm-pane-row">
            <Select
              data-action="assign-target"
              placeholder={actions.includes('assign_pool') ? '分派给…' : '指派 / 转派给…'}
              style={{ flex: 1 }}
              showSearch
              optionFilterProp="label"
              options={assignablePool.map((u) => ({ value: u.id, label: u.full_name }))}
              value={assignTarget}
              onChange={setAssignTarget}
            />
            <Button
              data-action="assign-confirm"
              type="primary"
              loading={busy}
              onClick={() => {
                if (!assignTarget) return message.warning('请选择人员')
                props.onAssign(assignTarget)
              }}
            >
              {actions.includes('assign_pool') ? '分派' : '指派'}
            </Button>
          </div>
        </div>
      )}

      {pane === 'approve' && (
        <div className="cm-pane">
          <Select
            data-action="approve-assignee"
            placeholder="通过后指派给…"
            style={{ width: '100%' }}
            showSearch
            optionFilterProp="label"
            options={assignablePool.map((u) => ({ value: u.id, label: u.full_name }))}
            value={assignTarget}
            onChange={setAssignTarget}
          />
          <div className="cm-pane-row" style={{ marginTop: 8 }}>
            <Button
              data-action="approve-accept"
              type="primary"
              style={{ flex: 1 }}
              loading={busy}
              onClick={() => {
                if (!assignTarget) return message.warning('请选择指派人')
                props.onApprove(true, assignTarget)
              }}
            >
              ✓ 通过 + 指派
            </Button>
            <Button data-action="approve-reject" danger onClick={() => props.onApprove(false)}>
              ✕ 拒绝
            </Button>
          </div>
        </div>
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
