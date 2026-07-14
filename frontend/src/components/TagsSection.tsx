import { useState } from 'react'
import { Popover, App as AntApp } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getTags, setTaskTags } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Tag } from '../api/types'
import { openTagLink, TAG_COLORS } from '../lib/badges'

interface Props {
  taskId: number
  tags: Tag[] // currently applied to the task
  canEdit: boolean
  onChanged: () => void
}

// Tags are created / edited (incl. their link) in the 标签 management page. Here a
// task editor only attaches/detaches existing tags. Clicking an applied tag opens
// its link (if any) in a new tab.
export function TagsSection({ taskId, tags, canEdit, onChanged }: Props) {
  const { message } = AntApp.useApp()
  const [pickerOpen, setPickerOpen] = useState(false)

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

  const toggle = (tag: Tag) => {
    const ids = applied.has(tag.id)
      ? tags.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...tags.map((t) => t.id), tag.id]
    setM.mutate(ids)
  }

  return (
    <section className="cd-sec">
      <div className="cd-sec-h">
        <span className="ic">🏷</span>标签
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {tags.length === 0 && <span className="cd-empty">暂无标签</span>}
        {tags.map((t) => (
          <span
            key={t.id}
            className="tag-chip"
            style={{ background: TAG_COLORS[t.color], cursor: t.link ? 'pointer' : 'default' }}
            onClick={() => openTagLink(t)}
            title={t.link ? `打开链接：${t.link}` : t.name}
          >
            {t.name}
            {t.link && ' 🔗'}
          </span>
        ))}
        {canEdit && (
          <Popover
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            trigger="click"
            placement="bottomLeft"
            content={
              <div style={{ width: 220 }}>
                {palette.length === 0 && (
                  <div className="cd-empty">暂无标签，请到「管理 · 标签」创建</div>
                )}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    maxHeight: 240,
                    overflowY: 'auto',
                  }}
                >
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
              </div>
            }
          >
            <button type="button" className="cd-add">
              + 标签
            </button>
          </Popover>
        )}
      </div>
    </section>
  )
}
