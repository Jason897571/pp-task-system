import { useState } from 'react'
import { Button, Checkbox, Input, Progress, App as AntApp } from 'antd'
import { useMutation } from '@tanstack/react-query'
import {
  createChecklist,
  createChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  updateChecklist,
  updateChecklistItem,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Checklist } from '../api/types'

interface Props {
  taskId: number
  checklists: Checklist[]
  canEdit: boolean
  onChanged: () => void
}

export function ChecklistsSection({ taskId, checklists, canEdit, onChanged }: Props) {
  const { message } = AntApp.useApp()
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const handle = <T,>(p: Promise<T>): Promise<void> =>
    p.then(() => onChanged()).catch((e) => {
      message.error(errMessage(e))
    })

  const addChecklistM = useMutation({
    mutationFn: () => createChecklist(taskId, newTitle.trim()),
    onSuccess: () => {
      setNewTitle('')
      setAdding(false)
      onChanged()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <section className="cd-sec">
      <div className="cd-sec-h">
        <span className="ic">☑</span>清单
      </div>
      {checklists.length === 0 && <span className="cd-empty">暂无清单</span>}
      {checklists.map((cl) => (
        <ChecklistBlock key={cl.id} checklist={cl} canEdit={canEdit} handle={handle} />
      ))}

      {canEdit &&
        (adding ? (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Input
              size="small"
              autoFocus
              placeholder="清单标题"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onPressEnter={() => newTitle.trim() && addChecklistM.mutate()}
            />
            <Button size="small" type="primary" disabled={!newTitle.trim()} onClick={() => addChecklistM.mutate()}>
              添加
            </Button>
            <Button size="small" onClick={() => setAdding(false)}>
              取消
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="cd-add"
            style={{ marginTop: 8 }}
            onClick={() => setAdding(true)}
          >
            + 添加清单
          </button>
        ))}
    </section>
  )
}

function ChecklistBlock({
  checklist,
  canEdit,
  handle,
}: {
  checklist: Checklist
  canEdit: boolean
  handle: <T>(p: Promise<T>) => Promise<void>
}) {
  const [addItemText, setAddItemText] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(checklist.title)

  const total = checklist.items.length
  const done = checklist.items.filter((i) => i.is_done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  return (
    <div
      style={{
        background: 'var(--card-bg)',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {renaming ? (
          <Input
            size="small"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onPressEnter={() => {
              if (title.trim()) handle(updateChecklist(checklist.id, { title: title.trim() }))
              setRenaming(false)
            }}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <b style={{ flex: 1 }}>{checklist.title}</b>
        )}
        <span style={{ color: 'var(--subtle)', fontSize: 12 }}>
          {done}/{total}
        </span>
        {canEdit && !renaming && (
          <>
            <a onClick={() => setRenaming(true)} style={{ fontSize: 12 }}>
              改名
            </a>
            <a
              onClick={() => handle(deleteChecklist(checklist.id))}
              style={{ fontSize: 12, color: '#f87168' }}
            >
              删除
            </a>
          </>
        )}
      </div>

      <Progress percent={pct} size="small" style={{ margin: '6px 0' }} />

      {checklist.items.map((item) => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
          <Checkbox
            checked={item.is_done}
            disabled={!canEdit}
            onChange={(e) => handle(updateChecklistItem(item.id, { is_done: e.target.checked }))}
          >
            <span style={{ textDecoration: item.is_done ? 'line-through' : 'none', color: 'var(--text)' }}>
              {item.content}
            </span>
          </Checkbox>
          <span style={{ flex: 1 }} />
          {canEdit && (
            <a
              onClick={() => handle(deleteChecklistItem(item.id))}
              style={{ fontSize: 12, color: 'var(--subtle)' }}
            >
              ✕
            </a>
          )}
        </div>
      ))}

      {canEdit && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <Input
            size="small"
            placeholder="添加项目"
            value={addItemText}
            onChange={(e) => setAddItemText(e.target.value)}
            onPressEnter={() => {
              if (addItemText.trim()) {
                handle(createChecklistItem(checklist.id, addItemText.trim())).then(() =>
                  setAddItemText(''),
                )
              }
            }}
          />
          <Button
            size="small"
            disabled={!addItemText.trim()}
            onClick={() =>
              handle(createChecklistItem(checklist.id, addItemText.trim())).then(() =>
                setAddItemText(''),
              )
            }
          >
            添加
          </Button>
        </div>
      )}
    </div>
  )
}
