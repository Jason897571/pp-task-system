import { useState } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Button, Dropdown, Input } from 'antd'
import type { BoardColumn as Col, Task, User } from '../api/types'
import { CardFront } from './TaskCard'
import { canDrag } from '../lib/actions'

function DraggableCard({
  task,
  col,
  me,
  onOpen,
}: {
  task: Task
  col: Col
  me: Pick<User, 'id' | 'role'>
  onOpen: (id: number) => void
}) {
  const draggable = canDrag(task, me)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: !draggable,
  })

  return (
    <div
      ref={setNodeRef}
      className={`card ${isDragging ? 'dragging' : ''}`}
      onClick={() => onOpen(task.id)}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
      <CardFront task={task} columnKind={col.kind} />
    </div>
  )
}

interface Props {
  col: Col
  tasks: Task[]
  me: Pick<User, 'id' | 'role'>
  isSuperAdmin: boolean
  onOpenCard: (id: number) => void
  onAddCard: (colId: number, title: string) => void
  onRenameColumn: (colId: number, name: string) => void
  onDeleteColumn: (colId: number) => void
}

export function BoardColumnView({
  col,
  tasks,
  me,
  isSuperAdmin,
  onOpenCard,
  onAddCard,
  onRenameColumn,
  onDeleteColumn,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id, data: { col } })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(col.name)

  // + 添加卡片 only on start-kind columns and not for super_admin (spec §7.2).
  const showAddCard = col.kind === 'start' && !isSuperAdmin

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
            <span className="count">{tasks.length}</span>
            <span className="lspacer" />
            {isSuperAdmin && (
              <Dropdown
                placement="bottomRight"
                menu={{
                  items: [
                    { key: 'rename', label: '改列名', onClick: () => setRenaming(true) },
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
          <DraggableCard key={t.id} task={t} col={col} me={me} onOpen={onOpenCard} />
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
