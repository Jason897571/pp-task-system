import { useEffect, useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Button, Dropdown, Input, Modal, Select } from 'antd'
import type { BoardColumn as Col, Department, Task, User } from '../api/types'
import { CardFront } from './TaskCard'
import { adjacentColumns, canDrag } from '../lib/actions'

// Sentinel for the "加入需求池" choice in the create-card picker (no real user
// has id 0, so it can never collide with an assignee).
const POOL = 0

// Managers create cards through this modal: pick an assignee, or choose
// 加入需求池 to drop the task into the pool (keeps the board, no assignee).
function AddCardModal({
  open,
  assignees,
  departments,
  isSuperAdmin,
  onCancel,
  onCreate,
}: {
  open: boolean
  assignees: User[]
  departments: Department[]
  isSuperAdmin: boolean
  onCancel: () => void
  onCreate: (title: string, assigneeId: number | null, departmentId: number | null) => void
}) {
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<number>(POOL)
  const [departmentId, setDepartmentId] = useState<number | null>(null)

  // Reset to a clean slate each time the modal is opened.
  useEffect(() => {
    if (open) {
      setTitle('')
      setAssignee(POOL)
      setDepartmentId(null)
    }
  }, [open])

  // super_admin has no department of their own, so when they drop a task into
  // the (department-scoped) pool they must pick which department's pool it joins.
  const needDept = isSuperAdmin && assignee === POOL
  const blocked = !title.trim() || (needDept && departmentId == null)

  const submit = () => {
    if (blocked) return
    onCreate(title.trim(), assignee === POOL ? null : assignee, departmentId)
  }

  return (
    <Modal
      title="创建卡片"
      open={open}
      onCancel={onCancel}
      onOk={submit}
      okText="创建"
      cancelText="取消"
      okButtonProps={{ disabled: blocked }}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input.TextArea
          autoFocus
          rows={2}
          placeholder="卡片标题…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onPressEnter={(e) => {
            e.preventDefault()
            submit()
          }}
        />
        <div>
          <div style={{ marginBottom: 6, color: 'var(--subtle)', fontSize: 13 }}>指派给</div>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
            value={assignee}
            onChange={setAssignee}
            options={[
              { label: '🫧 加入需求池（暂不指派）', value: POOL },
              ...assignees.map((u) => ({ label: u.full_name, value: u.id })),
            ]}
          />
        </div>
        {needDept && (
          <div>
            <div style={{ marginBottom: 6, color: 'var(--subtle)', fontSize: 13 }}>
              需求池所属部门
            </div>
            <Select
              placeholder="选择部门（该部门成员才能看到并领取）"
              style={{ width: '100%' }}
              value={departmentId ?? undefined}
              onChange={setDepartmentId}
              options={departments.map((d) => ({ label: d.name, value: d.id }))}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

function DraggableCard({
  task,
  col,
  columns,
  me,
  onOpen,
  onMove,
  onRestore,
  onCopy,
}: {
  task: Task
  col: Col
  columns: Col[]
  me: Pick<User, 'id' | 'role'>
  onOpen: (id: number) => void
  onMove: (taskId: number, columnId: number) => void
  onRestore?: (task: Task) => void
  onCopy?: (task: Task) => void
}) {
  const draggable = canDrag(task, me)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !draggable,
  })
  // ‹ / › move the card to the previous / next column (same rules as drag).
  const { prev, next } = adjacentColumns(columns, task, me)

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
      {prev && (
        <button
          type="button"
          className="card-move card-move-l"
          title={`移到「${prev.name}」`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMove(task.id, prev.id)
          }}
        >
          ‹
        </button>
      )}
      {next && (
        <button
          type="button"
          className="card-move card-move-r"
          title={`移到「${next.name}」`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMove(task.id, next.id)
          }}
        >
          ›
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
          ↩ 放回原看板
        </button>
      )}
    </div>
  )
}

interface Props {
  col: Col
  columns: Col[]
  tasks: Task[]
  me: Pick<User, 'id' | 'role'>
  isSuperAdmin: boolean
  assignees: User[]
  departments: Department[]
  onOpenCard: (id: number) => void
  onMove: (taskId: number, columnId: number) => void
  onAddCard: (
    colId: number,
    title: string,
    assigneeId?: number | null,
    departmentId?: number | null,
  ) => void
  onRenameColumn: (colId: number, name: string) => void
  onDeleteColumn: (colId: number) => void
  onSetFinal: (colId: number, isFinal: boolean) => void
  onSetReview: (colId: number, requiresReview: boolean) => void
  onRestore?: (task: Task) => void
  onCopy?: (task: Task) => void
}

export function BoardColumnView({
  col,
  columns,
  tasks,
  me,
  isSuperAdmin,
  assignees,
  departments,
  onOpenCard,
  onMove,
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
  const [modalOpen, setModalOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(col.name)

  // Managers (admin/super) create via the modal (pick assignee or 加入需求池).
  // Members keep the lightweight inline title box (self-submit -> 待审批).
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
    onAddCard(col.id, t)
    setTitle('')
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
            columns={columns}
            me={me}
            onOpen={onOpenCard}
            onMove={onMove}
            onRestore={onRestore}
            onCopy={onCopy}
          />
        ))}
      </div>

      {showAddCard &&
        (isManager ? (
          <>
            <div className="add-card" onClick={() => setModalOpen(true)}>
              + 添加卡片
            </div>
            <AddCardModal
              open={modalOpen}
              assignees={assignees}
              departments={departments}
              isSuperAdmin={isSuperAdmin}
              onCancel={() => setModalOpen(false)}
              onCreate={(t, assigneeId, departmentId) => {
                onAddCard(col.id, t, assigneeId, departmentId)
                setModalOpen(false)
              }}
            />
          </>
        ) : adding ? (
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
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <Button type="primary" size="small" onClick={submitAdd}>
                添加卡片
              </Button>
              <Button size="small" onClick={() => setAdding(false)}>
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
