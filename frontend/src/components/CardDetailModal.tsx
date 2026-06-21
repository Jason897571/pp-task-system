import { useState } from 'react'
import { Button, Input, Modal, Spin, Upload, App as AntApp } from 'antd'
import type { UploadFile } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  applyTask,
  approveTask,
  assignTask,
  getAssignableUsers,
  getTask,
  reviewTask,
  startTask,
  submitTask,
  updateTask,
  uploadFile,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { BoardColumn, User } from '../api/types'
import { CardActions } from './CardActions'
import { ChecklistsSection } from './ChecklistsSection'
import { AttachmentsSection, AttachmentList } from './AttachmentsSection'
import { avatarColor, dueLabel, dueState, initial } from '../lib/badges'

interface Props {
  taskId: number
  columns: BoardColumn[]
  onClose: () => void
}

export function CardDetailModal({ taskId, columns, onClose }: Props) {
  const { user } = useAuth()
  const { message } = AntApp.useApp()
  const qc = useQueryClient()

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => getTask(taskId),
  })

  // Candidate assignees for admin assign/approve — only admins fetch the directory.
  const { data: users = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: getAssignableUsers,
    enabled: user?.role === 'admin' || user?.role === 'super_admin',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['task', taskId] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    qc.invalidateQueries({ queryKey: ['pool'] })
  }

  const wrap = <T,>(fn: () => Promise<T>, ok: string) =>
    fn()
      .then(() => {
        message.success(ok)
        invalidate()
      })
      .catch((e) => message.error(errMessage(e)))

  const startM = useMutation({ mutationFn: () => startTask(taskId) })
  // Submit a deliverable, then (if files were attached) upload them against the
  // newest deliverable. Contract's submit returns Task (no deliverable id), so we
  // re-fetch detail and target the most recent deliverable.
  const submitM = useMutation({
    mutationFn: async ({ note, files }: { note: string; files: File[] }) => {
      await submitTask(taskId, note)
      if (files.length > 0) {
        const detail = await getTask(taskId)
        const latest = detail.deliverables.reduce<number | null>(
          (max, d) => (max === null || d.id > max ? d.id : max),
          null,
        )
        if (latest !== null) {
          for (const f of files) await uploadFile(f, 'deliverable', latest)
        }
      }
    },
  })
  const applyM = useMutation({ mutationFn: () => applyTask(taskId) })
  const reviewM = useMutation({
    mutationFn: (b: { approve: boolean; comment?: string }) => reviewTask(taskId, b),
  })
  const approveM = useMutation({
    mutationFn: (b: { approve: boolean; assignee_id?: number }) => approveTask(taskId, b),
  })
  const assignM = useMutation({ mutationFn: (id: number) => assignTask(taskId, id) })
  const updateM = useMutation({ mutationFn: (description: string) => updateTask(taskId, { description }) })

  const busy =
    startM.isPending ||
    submitM.isPending ||
    applyM.isPending ||
    reviewM.isPending ||
    approveM.isPending ||
    assignM.isPending

  // Inline description editing (admin/super) + inline 产出 composer state.
  const [editingDesc, setEditingDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [outNote, setOutNote] = useState('')
  const [outFiles, setOutFiles] = useState<UploadFile[]>([])

  const column = task ? columns.find((c) => c.id === task.column_id) ?? null : null
  const columnKind = column?.kind ?? null

  // Edit permission for tags/checklists/attachments: admin/super_admin or assignee.
  const isManager = user?.role === 'admin' || user?.role === 'super_admin'
  const canEdit = !!task && !!user && (isManager || task.assignee?.id === user.id)
  // Output composer shows in the 进行中 column for the assignee or a manager.
  const canCompose =
    !!task && !!user && columnKind === 'doing' && (isManager || task.assignee?.id === user.id)

  const saveDesc = () => {
    updateM
      .mutateAsync(descDraft)
      .then(() => {
        message.success('已更新描述')
        setEditingDesc(false)
        invalidate()
      })
      .catch((e) => message.error(errMessage(e)))
  }

  const submitOutput = () => {
    const files = outFiles.map((f) => f.originFileObj as File).filter(Boolean)
    wrap(() => submitM.mutateAsync({ note: outNote, files }), '已提交产出').then(() => {
      setOutNote('')
      setOutFiles([])
    })
  }

  const due = task ? dueState(task.due_date, columnKind) : null
  const status = task ? deliverStatus(columnKind, task.is_rework) : null

  const cardActions = task && user && (
    <CardActions
      task={task}
      columnKind={columnKind}
      me={{ id: user.id, role: user.role }}
      assignableUsers={assignableUsers(users, task.applications.map((a) => a.applicant))}
      busy={busy}
      onStart={() => wrap(() => startM.mutateAsync(), '已开始')}
      onSubmit={(note, files) => wrap(() => submitM.mutateAsync({ note, files }), '已提交产出')}
      onApply={() => wrap(() => applyM.mutateAsync(), '已申请')}
      onReview={(approve, comment) =>
        wrap(() => reviewM.mutateAsync({ approve, comment }), approve ? '已通过' : '已打回')
      }
      onApprove={(approve, assigneeId) =>
        wrap(
          () => approveM.mutateAsync({ approve, assignee_id: assigneeId }),
          approve ? '已通过并指派' : '已拒绝',
        )
      }
      onAssign={(id) => wrap(() => assignM.mutateAsync(id), '已指派')}
    />
  )

  return (
    <Modal open width={720} footer={null} onCancel={onClose} title={null} className="cm-modal">
      {isLoading || !task || !user ? (
        <div style={{ display: 'grid', placeItems: 'center', height: 220, background: '#0f1320' }}>
          <Spin />
        </div>
      ) : (
        <div className="cm">
          {/* ===================== 需求 ===================== */}
          <div className="cm-req">
            <div className="cm-zonetag">需求 · REQUIREMENT</div>
            <div className="cm-titlerow">
              <h2 className="cm-title">{task.title}</h2>
            </div>
            <div className="cm-chips">
              {task.assignee ? (
                <span className="cm-chip">
                  <span
                    className="av-sm"
                    style={{ width: 18, height: 18, background: avatarColor(task.assignee.id) }}
                  >
                    {initial(task.assignee.full_name)}
                  </span>
                  {task.assignee.full_name}
                </span>
              ) : (
                <span className="cm-chip muted">未指派</span>
              )}
              <span className="cm-chip">{column ? column.name : lifecycleLabel(task.lifecycle)}</span>
              {task.due_date && due && (
                <span className="cm-chip due">🕒 {dueLabel(task.due_date)}</span>
              )}
              {task.priority === 'high' && <span className="cm-chip hot">⬆ 高优先级</span>}
              {task.is_rework && <span className="cm-chip rw">↩ 重做</span>}
            </div>

            <section className="cd-sec">
              <div className="cd-sec-h">
                <span className="ic">📝</span>需求描述
                {isManager && !editingDesc && (
                  <button
                    type="button"
                    className="cm-edit"
                    onClick={() => {
                      setDescDraft(task.description || '')
                      setEditingDesc(true)
                    }}
                  >
                    ✎ 编辑
                  </button>
                )}
              </div>
              {editingDesc ? (
                <div>
                  <Input.TextArea
                    autoSize={{ minRows: 3, maxRows: 12 }}
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    placeholder="输入需求描述…"
                  />
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <Button
                      type="primary"
                      size="small"
                      loading={updateM.isPending}
                      onClick={saveDesc}
                    >
                      保存
                    </Button>
                    <Button size="small" onClick={() => setEditingDesc(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className={`cm-desc ${task.description ? '' : 'empty'} ${isManager ? 'editable' : ''}`}
                  onClick={
                    isManager
                      ? () => {
                          setDescDraft(task.description || '')
                          setEditingDesc(true)
                        }
                      : undefined
                  }
                >
                  {task.description || (isManager ? '点击添加描述…' : '暂无描述')}
                </div>
              )}
            </section>

            <ChecklistsSection
              taskId={task.id}
              checklists={task.checklists}
              canEdit={canEdit}
              onChanged={invalidate}
            />
            <AttachmentsSection
              taskId={task.id}
              attachments={task.attachments}
              canEdit={canEdit}
              onChanged={invalidate}
            />
          </div>

          {/* ===================== 流向 ===================== */}
          <div className="cm-flow">
            <span className="lab">需求</span>
            <span className="ln" />
            <span className="arr">▼</span>
            <span className="ln" />
            <span className="lab">产出</span>
          </div>

          {/* ===================== 产出 ===================== */}
          <div className="cm-out">
            <div className="cm-zonetag">产出 · DELIVERABLES</div>
            {status && (
              <div style={{ marginTop: 10 }}>
                <span className={`cm-banner ${status.cls}`}>{status.label}</span>
              </div>
            )}

            {task.lifecycle === 'open' && task.applications.length > 0 && (
              <section className="cd-sec">
                <div className="cd-sec-h">
                  <span className="ic">🙋</span>申请人
                </div>
                {task.applications.map((a) => (
                  <div key={a.id} className="cm-appl">
                    <span className="av-sm" style={{ background: avatarColor(a.applicant.id) }}>
                      {initial(a.applicant.full_name)}
                    </span>
                    {a.applicant.full_name}
                  </div>
                ))}
              </section>
            )}

            {task.deliverables.length === 0 ? (
              <div className="cd-empty" style={{ marginTop: 12 }}>
                暂无产出
              </div>
            ) : (
              <div className="cm-tl">
                {task.deliverables.map((d, i) => {
                  const last = i === task.deliverables.length - 1
                  return (
                    <div
                      key={d.id}
                      className={`cm-tlitem ${last && status ? status.tlcls : ''}`}
                    >
                      <div className="cm-glass">
                        <div className="cm-tlhead">
                          <span
                            className="av-sm"
                            style={{ width: 20, height: 20, background: avatarColor(d.submitter.id) }}
                          >
                            {initial(d.submitter.full_name)}
                          </span>
                          <b>{d.submitter.full_name}</b>
                          <span className="tm">{dueLabel(d.created_at)}</span>
                          {last && status && (
                            <span className={`cm-stat ${status.cls}`}>{status.short}</span>
                          )}
                        </div>
                        {d.note && <div className="cm-note">{d.note}</div>}
                        <AttachmentList attachments={d.attachments} pill />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {canCompose && (
              <div className="cm-composer">
                <div className="cd-sec-h" style={{ marginBottom: 8 }}>
                  <span className="ic">⬆</span>提交产出
                </div>
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 8 }}
                  value={outNote}
                  onChange={(e) => setOutNote(e.target.value)}
                  placeholder="填写产出说明 / 链接…"
                />
                <div className="cm-composer-row">
                  <Upload
                    fileList={outFiles}
                    beforeUpload={() => false}
                    onChange={({ fileList }) => setOutFiles(fileList)}
                    multiple
                  >
                    <Button size="small">📎 上传文件</Button>
                  </Upload>
                  <Button
                    type="primary"
                    loading={submitM.isPending}
                    disabled={!outNote.trim() && outFiles.length === 0}
                    onClick={submitOutput}
                  >
                    提交产出
                  </Button>
                </div>
              </div>
            )}

            {cardActions && <div className="cm-actions">{cardActions}</div>}
          </div>
        </div>
      )}
    </Modal>
  )
}

// Current output status derived from the column kind + rework flag (truthful, no
// per-deliverable state in the model). Drives the banner + last-node pill colour.
function deliverStatus(
  kind: string | null,
  rework: boolean,
): { label: string; short: string; cls: string; tlcls: string } | null {
  if (kind === 'review') return { label: '⏳ 待审核中', short: '待审核', cls: 'wait', tlcls: '' }
  if (kind === 'done') return { label: '✓ 已通过 · 已完成', short: '已通过', cls: 'ok', tlcls: 'ok' }
  if (kind === 'doing' && rework)
    return { label: '↩ 已打回 · 待重新提交', short: '已打回', cls: 'rej', tlcls: 'rej' }
  return null
}

function lifecycleLabel(lc: string): string {
  switch (lc) {
    case 'open':
      return '任务池'
    case 'pending_approval':
      return '待审批'
    case 'declined':
      return '已拒绝'
    default:
      return ''
  }
}

// Merge applicants first (so admin can pick from them) then dedupe with directory.
function assignableUsers(directory: User[], applicants: User[]): User[] {
  const seen = new Set<number>()
  const out: User[] = []
  for (const u of [...applicants, ...directory]) {
    if (!seen.has(u.id)) {
      seen.add(u.id)
      out.push(u)
    }
  }
  return out
}
