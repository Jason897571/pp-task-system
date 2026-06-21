import { useState } from 'react'
import { Button, Input, Popover, Select, App as AntApp } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createTag, getTags, setTaskTags } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Tag } from '../api/types'
import { TAG_COLORS, TAG_COLOR_KEYS } from '../lib/badges'

interface Props {
  taskId: number
  tags: Tag[] // currently applied to the task
  canEdit: boolean
  onChanged: () => void
}

export function TagsSection({ taskId, tags, canEdit, onChanged }: Props) {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLOR_KEYS[0])

  const { data: palette = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
    enabled: canEdit,
  })

  const applied = new Set(tags.map((t) => t.id))

  const setM = useMutation({
    mutationFn: (ids: number[]) => setTaskTags(taskId, ids),
    onSuccess: () => onChanged(),
    onError: (e) => message.error(errMessage(e)),
  })

  const createM = useMutation({
    mutationFn: () => createTag({ name: newName.trim(), color: newColor }),
    onSuccess: (tag) => {
      setNewName('')
      qc.invalidateQueries({ queryKey: ['tags'] })
      // Apply the freshly created tag to the task right away.
      setM.mutate([...tags.map((t) => t.id), tag.id])
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const toggle = (tag: Tag) => {
    const ids = applied.has(tag.id)
      ? tags.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...tags.map((t) => t.id), tag.id]
    setM.mutate(ids)
  }

  return (
    <section style={{ marginTop: 18 }}>
      <h4>🏷 标签</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {tags.length === 0 && <span style={{ color: 'var(--subtle)', fontSize: 13 }}>暂无标签</span>}
        {tags.map((t) => (
          <span
            key={t.id}
            className="tag-chip"
            style={{ background: TAG_COLORS[t.color] }}
            onClick={canEdit ? () => toggle(t) : undefined}
            title={canEdit ? '点击移除' : t.name}
          >
            {t.name}
          </span>
        ))}
        {canEdit && (
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            trigger="click"
            placement="bottomLeft"
            content={
              <div style={{ width: 240 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                  {palette.map((t) => (
                    <div
                      key={t.id}
                      className={`tag-row ${applied.has(t.id) ? 'on' : ''}`}
                      style={{ background: TAG_COLORS[t.color] }}
                      onClick={() => toggle(t)}
                    >
                      {t.name} {applied.has(t.id) ? '✓' : ''}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <Select
                    size="small"
                    style={{ width: 80 }}
                    value={newColor}
                    onChange={setNewColor}
                    options={TAG_COLOR_KEYS.map((c) => ({
                      value: c,
                      label: <span style={{ display: 'inline-block', width: 40, height: 12, borderRadius: 3, background: TAG_COLORS[c] }} />,
                    }))}
                  />
                  <Input
                    size="small"
                    placeholder="新标签名"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onPressEnter={() => newName.trim() && createM.mutate()}
                  />
                  <Button
                    size="small"
                    type="primary"
                    disabled={!newName.trim()}
                    onClick={() => createM.mutate()}
                  >
                    新建
                  </Button>
                </div>
              </div>
            }
          >
            <Button size="small" type="dashed">
              + 标签
            </Button>
          </Popover>
        )}
      </div>
    </section>
  )
}
