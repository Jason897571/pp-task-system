import { Modal, Spin, Typography, App as AntApp } from 'antd'
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
  uploadFile,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { BoardColumn, User } from '../api/types'
import { CardActions } from './CardActions'
import { TagsSection } from './TagsSection'
import { ChecklistsSection } from './ChecklistsSection'
import { AttachmentsSection, AttachmentList } from './AttachmentsSection'
import { avatarColor, dueLabel, initial } from '../lib/badges'

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

  const busy =
    startM.isPending ||
    submitM.isPending ||
    applyM.isPending ||
    reviewM.isPending ||
    approveM.isPending ||
    assignM.isPending

  const column = task ? columns.find((c) => c.id === task.column_id) ?? null : null
  const columnKind = column?.kind ?? null

  // Edit permission for tags/checklists/attachments: admin/super_admin or assignee.
  const canEdit =
    !!task &&
    !!user &&
    (user.role === 'admin' ||
      user.role === 'super_admin' ||
      task.assignee?.id === user.id)

  return (
    <Modal open width={768} footer={null} onCancel={onClose} title={null}>
      {isLoading || !task || !user ? (
        <div style={{ display: 'grid', placeItems: 'center', height: 200 }}>
          <Spin />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Typography.Title level={4} style={{ marginTop: 0 }}>
              {task.title}
            </Typography.Title>
            <Typography.Text type="secondary">
              {column ? `在 ${column.name} 列中` : lifecycleLabel(task.lifecycle)}
              {task.is_rework && ' · ↩ 重做'}
              {task.assignee && ` · 负责人 ${task.assignee.full_name}`}
            </Typography.Text>

            <section style={{ marginTop: 18 }}>
              <h4>📝 描述</h4>
              <div
                style={{
                  background: 'var(--card-bg)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {task.description || '（无描述）'}
              </div>
            </section>

            {task.due_date && (
              <section style={{ marginTop: 14 }}>
                <h4>🕒 截止</h4>
                <div>{dueLabel(task.due_date)}</div>
              </section>
            )}

            <TagsSection
              taskId={task.id}
              tags={task.tags}
              canEdit={canEdit}
              onChanged={invalidate}
            />

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

            <section style={{ marginTop: 18 }}>
              <h4>📦 产出历史</h4>
              {task.deliverables.length === 0 ? (
                <Typography.Text type="secondary">暂无产出</Typography.Text>
              ) : (
                task.deliverables.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      background: 'var(--card-bg)',
                      borderRadius: 6,
                      padding: '8px 10px',
                      marginBottom: 6,
                    }}
                  >
                    <b>{d.submitter.full_name}</b> · {d.note}
                    <AttachmentList attachments={d.attachments} />
                  </div>
                ))
              )}
            </section>

            {task.lifecycle === 'open' && task.applications.length > 0 && (
              <section style={{ marginTop: 18 }}>
                <h4>🙋 申请人</h4>
                {task.applications.map((a) => (
                  <div key={a.id} style={{ padding: '4px 0' }}>
                    <span
                      className="av-sm"
                      style={{
                        background: avatarColor(a.applicant.id),
                        display: 'inline-grid',
                        verticalAlign: 'middle',
                        marginRight: 8,
                      }}
                    >
                      {initial(a.applicant.full_name)}
                    </span>
                    {a.applicant.full_name}
                  </div>
                ))}
              </section>
            )}
          </div>

          <div style={{ width: 180, flexShrink: 0 }}>
            <div className="grp" style={{ padding: '0 0 4px' }}>
              动作
            </div>
            <CardActions
              task={task}
              columnKind={columnKind}
              me={{ id: user.id, role: user.role }}
              assignableUsers={assignableUsers(users, task.applications.map((a) => a.applicant))}
              busy={busy}
              onStart={() => wrap(() => startM.mutateAsync(), '已开始')}
              onSubmit={(note, files) =>
                wrap(() => submitM.mutateAsync({ note, files }), '已提交产出')
              }
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
          </div>
        </div>
      )}
    </Modal>
  )
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
