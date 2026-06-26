import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Button, Dropdown, Input, Select } from 'antd'
import type { BoardColumn as Col, Task, User } from '../api/types'
import { CardFront } from './TaskCard'
import { canDrag } from '../lib/actions'

function DraggableCard({
  task,
  col,
  me,
  onOpen,
  onRestore,
  onCopy,
}: {
  task: Task
  col: Col
  me: Pick<User, 'id' | 'role'>
  onOpen: (id: number) => void
  onRestore?: (task: Task) => void
  onCopy?: (task: Task) => void
}) {
  const draggable = canDrag(task, me)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !draggable,
  })

  // Assignee's personal card colour (set in 个人设置) tints their cards for everyone.
  const cardColor = task.assignee?.card_color || undefined

  return (
    <div
      ref={setNodeRef}
      className={`card ${isDragging ? 'dragging' : ''} ${col.is_final ? 'card-done' : ''}`}
      data-spine={task.priority === 'high' ? 'high' : undefined}
      style={cardColor ? { background: cardColor, borderColor: cardColor } : undefined}
      onClick={() => onOpen(task.id)}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
      {onCopy && (
        <button
          type="button"
          className="card-copy"
          title="复制卡片并指派给他人（仅复制需求，不含产出）"
          onClick={(e) => {
            e.stopPropagation()
            onCopy(task)
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          ⧉
        </button>
      )}
      <CardFront task={task} columnKind={col.kind} isFinal={col.is_final} />
      {onRestore && (
        <button
          type="button"
          className="card-restore"
          onClick={(e) => {
            e.stopPropagation()
            onRestore(task)
          }}
        >
          ↩ 放回看板
        </button>
      )}
    </div>
  )
}

interface Props {
  col: Col
  tasks: Task[]
  me: Pick<User, 'id' | 'role'>
  isSuperAdmin: boolean
  assignees: User[]
  onOpenCard: (id: number) => void
  onAddCard: (colId: number, title: string, assigneeId?: number | null) => void
  onRenameColumn: (colId: number, name: string) => void
  onDeleteColumn: (colId: number) => void
  onSetFinal: (colId: number, isFinal: boolean) => void
  onSetReview: (colId: number, requiresReview: boolean) => void
  onRestore?: (task: Task) => void
  onCopy?: (task: Task) => void
}

export function BoardColumnView({
  col,
  tasks,
  me,
  isSuperAdmin,
  assignees,
  onOpenCard,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
  onSetFinal,
  onSetReview,
  onRestore,
  onCopy,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id, data: { col } })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState<number | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(col.name)

  // Managers (admin/super) pick an assignee at creation; leaving it empty drops
  // the task into the pool. Members keep the self-submit flow (no picker).
  const isManager = me.role === 'admin' || me.role === 'super_admin'
  // + 添加卡片 only on start-kind columns (spec §7.2; super_admin included so
  // managers can create-and-assign or seed the pool directly from the board).
  const showAddCard = col.kind === 'start'

  const submitAdd = () => {
    const t = title.trim()
    if (!t) {
      setAdding(false)
      return
    }
    onAddCard(col.id, t, isManager ? assigneeId : undefined)
    setTitle('')
    setAssigneeId(null)
    setAdding(false)
  }

  return (
    <div className="list">
      <div className="list-head">
        {renaming ? (
          <Input
            size="small"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => {
              if (name.trim()) onRenameColumn(col.id, name.trim())
              setRenaming(false)
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <>
            <span>{col.name}</span>
            {col.requires_review && (
              <span className="col-review-tag" title="审核节点：成员提交后卡片在此等待管理员审核">
                🔒 审核
              </span>
            )}
            {col.is_final && (
              <span className="col-final-tag" title="最终验收完成列：卡片视为完成，周六自动归档">
                ✓ 最终验收
              </span>
            )}
            <span className="count">{tasks.length}</span>
            <span className="lspacer" />
            {isSuperAdmin && (
              <Dropdown
                placement="bottomRight"
                menu={{
                  items: [
                    { key: 'rename', label: '改列名', onClick: () => setRenaming(true) },
                    {
                      key: 'review',
                      label: col.requires_review ? '取消审核节点' : '设为审核节点',
                      onClick: () => onSetReview(col.id, !col.requires_review),
                    },
                    {
                      key: 'final',
                      label: col.is_final ? '取消最终验收' : '设为最终验收完成',
                      onClick: () => onSetFinal(col.id, !col.is_final),
                    },
                    {
                      key: 'delete',
                      label: '删除该列',
                      danger: true,
                      onClick: () => {
                        if (confirm(`删除列「${col.name}」？卡片将迁移到首列。`)) {
                          onDeleteColumn(col.id)
                        }
                      },
                    },
                  ],
                }}
              >
                <span style={{ cursor: 'pointer', color: 'var(--subtle)' }}>⋯</span>
              </Dropdown>
            )}
          </>
        )}
      </div>

      <div ref={setNodeRef} className={`cards ${isOver ? 'drag-over' : ''}`}>
        {tasks.map((t) => (
          <DraggableCard
            key={t.id}
            task={t}
            col={col}
            me={me}
            onOpen={onOpenCard}
            onRestore={onRestore}
            onCopy={onCopy}
          />
        ))}
      </div>

      {showAddCard &&
        (adding ? (
          <div style={{ marginTop: 6 }}>
            <Input.TextArea
              autoFocus
              rows={2}
              placeholder="为这张卡片输入标题…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault()
                submitAdd()
              }}
            />
            {isManager && (
              <Select
                size="small"
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: '100%', marginTop: 6 }}
                placeholder="不指派 → 进需求池"
                value={assigneeId ?? undefined}
                onChange={(v) => setAssigneeId(v ?? null)}
                options={assignees.map((u) => ({ label: u.full_name, value: u.id }))}
              />
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Button type="primary" size="small" onClick={submitAdd}>
                添加卡片
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setAdding(false)
                  setAssigneeId(null)
                }}
              >
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="add-card" onClick={() => setAdding(true)}>
            + 添加卡片
          </div>
        ))}
    </div>
  )
}
