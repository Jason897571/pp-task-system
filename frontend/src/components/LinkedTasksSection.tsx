import { useState } from 'react'
import { Modal, Popconfirm, Select, App as AntApp } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getTasks, linkTask, unlinkTask } from '../api/endpoints'
import { errMessage } from '../api/client'
import { PRIORITY_LABEL } from '../lib/badges'
import { fmtDateTime } from '../lib/tz'
import type { LinkedTask } from '../api/types'

function PreviewRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="lp-row">
      <span className="lp-k">{label}</span>
      <span className="lp-v">{value || '—'}</span>
    </div>
  )
}

// "关联任务" section: list related tasks as chips (#id 标题 · 状态). Clicking a chip
// opens a read-only preview popup; editors can add (search) / remove links.
export function LinkedTasksSection({
  taskId,
  links,
  canEdit,
  onChanged,
}: {
  taskId: number
  links: LinkedTask[]
  canEdit: boolean
  onChanged: () => void
}) {
  const { message } = AntApp.useApp()
  const [preview, setPreview] = useState<LinkedTask | null>(null)
  const [adding, setAdding] = useState(false)

  // Candidate tasks for the picker — visible on-board tasks, fetched lazily.
  const { data: candidates = [] } = useQuery({
    queryKey: ['link-candidates'],
    queryFn: () => getTasks({}),
    enabled: adding,
  })

  const linkM = useMutation({
    mutationFn: (lid: number) => linkTask(taskId, lid),
    onSuccess: () => {
      message.success('已关联')
      setAdding(false)
      onChanged()
    },
    onError: (e) => message.error(errMessage(e)),
  })
  const unlinkM = useMutation({
    mutationFn: (lid: number) => unlinkTask(taskId, lid),
    onSuccess: () => {
      message.success('已取消关联')
      onChanged()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const linkedIds = new Set(links.map((l) => l.id))
  const options = candidates
    .filter((t) => t.id !== taskId && !linkedIds.has(t.id))
    .map((t) => ({ value: t.id, label: `#${t.id} ${t.title}` }))

  return (
    <section className="cd-sec">
      <div className="cd-sec-h">
        <span className="ic">🔗</span>关联任务
      </div>
      {links.length === 0 && !adding && <span className="cd-empty">暂无关联任务</span>}

      <div className="link-chips">
        {links.map((l) => (
          <span key={l.id} className="link-chip">
            <button
              type="button"
              className="link-chip-main"
              onClick={() => setPreview(l)}
              title="查看关联任务"
            >
              <span className="link-no">#{l.id}</span>
              <span className="link-title">{l.title}</span>
              <span className="link-status">{l.status}</span>
            </button>
            {canEdit && (
              <Popconfirm
                title="取消关联？"
                okText="取消关联"
                cancelText="返回"
                okButtonProps={{ danger: true }}
                onConfirm={() => unlinkM.mutate(l.id)}
              >
                <span className="att-del" onClick={(e) => e.stopPropagation()} title="取消关联">
                  ✕
                </span>
              </Popconfirm>
            )}
          </span>
        ))}
      </div>

      {canEdit &&
        (adding ? (
          <Select
            autoFocus
            showSearch
            defaultOpen
            placeholder="搜索任务编号或标题…"
            style={{ width: '100%', marginTop: 8 }}
            optionFilterProp="label"
            options={options}
            onSelect={(v) => linkM.mutate(Number(v))}
            onBlur={() => setAdding(false)}
            notFoundContent="无可关联的任务"
          />
        ) : (
          <button
            type="button"
            className="cd-add"
            style={{ marginTop: 8 }}
            onClick={() => setAdding(true)}
          >
            + 关联任务
          </button>
        ))}

      <Modal
        open={!!preview}
        title={preview ? `🔗 #${preview.id} 关联任务` : ''}
        footer={null}
        onCancel={() => setPreview(null)}
        width={460}
      >
        {preview && (
          <div className="link-preview">
            <div className="lp-title">{preview.title}</div>
            <PreviewRow label="状态" value={preview.status} />
            <PreviewRow label="看板" value={preview.board} />
            <PreviewRow label="所在列" value={preview.column} />
            <PreviewRow label="负责人" value={preview.assignee?.full_name ?? '未指派'} />
            <PreviewRow label="优先级" value={PRIORITY_LABEL[preview.priority] ?? preview.priority} />
            <PreviewRow
              label="截止"
              value={preview.due_date ? fmtDateTime(preview.due_date) : '无'}
            />
          </div>
        )}
      </Modal>
    </section>
  )
}
