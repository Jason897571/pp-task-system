import { Fragment } from 'react'
import type { Task } from '../api/types'
import { PRIORITY_LABEL } from '../lib/badges'
import { dayDiffTZ, fmtMD, nowTZ } from '../lib/tz'
import { UserAvatar } from './UserAvatar'

// Urgency matrix: priority (rows) × day-to-DDL (columns), scrollable sideways.
// Columns are real calendar days in China time (plus 已逾期 / 更远 / 无期限 buckets
// at the ends), so you can scan "what P0 is due when" across a timeline.

const PRIS = ['high', 'normal', 'low'] as const
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const DAY_W = 122 // px per day column
const MAX_DAYS = 60 // cap the day range; anything further goes to a 更远 column
const MIN_DAYS = 13 // always show at least ~2 weeks of runway

type Col = { key: string; kind: 'overdue' | 'day' | 'far' | 'none'; diff: number }

export function UrgencyMatrix({
  tasks,
  onOpen,
}: {
  tasks: Task[]
  onOpen: (id: number) => void
}) {
  const today = nowTZ().startOf('day')
  const diffs = tasks.map((t) => dayDiffTZ(t.due_date))
  const maxFuture = Math.max(0, ...diffs.filter((d): d is number => d !== null && d >= 0))
  const endDiff = Math.min(Math.max(maxFuture, MIN_DAYS), MAX_DAYS)

  const hasOverdue = diffs.some((d) => d !== null && d < 0)
  const hasFar = diffs.some((d) => d !== null && d > endDiff)
  const hasNone = diffs.some((d) => d === null)

  const cols: Col[] = []
  if (hasOverdue) cols.push({ key: 'overdue', kind: 'overdue', diff: -1 })
  for (let d = 0; d <= endDiff; d++) cols.push({ key: `d${d}`, kind: 'day', diff: d })
  if (hasFar) cols.push({ key: 'far', kind: 'far', diff: endDiff + 1 })
  if (hasNone) cols.push({ key: 'none', kind: 'none', diff: 9999 })

  const colKey = (t: Task): string => {
    const d = dayDiffTZ(t.due_date)
    if (d === null) return 'none'
    if (d < 0) return 'overdue'
    if (d > endDiff) return 'far'
    return `d${d}`
  }
  const counts = new Map<string, number>()
  tasks.forEach((t) => counts.set(colKey(t), (counts.get(colKey(t)) ?? 0) + 1))

  const header = (c: Col) => {
    if (c.kind === 'overdue') return { top: '已逾期', bot: '' }
    if (c.kind === 'far') return { top: `${endDiff}天后`, bot: '' }
    if (c.kind === 'none') return { top: '无期限', bot: '' }
    const day = today.add(c.diff, 'day')
    return { top: c.diff === 0 ? '今天' : WD[day.day()], bot: day.format('M/D') }
  }

  return (
    <div className="umx-scroll">
      <div
        className="umx"
        style={{ gridTemplateColumns: `72px repeat(${cols.length}, ${DAY_W}px)` }}
      >
        <div className="umx-h umx-corner" />
        {cols.map((c) => {
          const h = header(c)
          const n = counts.get(c.key) ?? 0
          return (
            <div
              key={c.key}
              className={`umx-h ${c.kind === 'overdue' ? 'od' : ''} ${c.diff === 0 ? 'today' : ''}`}
            >
              <span className="umx-h-top">{h.top}</span>
              {h.bot && <span className="umx-h-bot">{h.bot}</span>}
              {n > 0 && <span className="umx-cnt">{n}</span>}
            </div>
          )
        })}

        {PRIS.map((pri) => (
          <Fragment key={pri}>
            <div className="umx-rl">
              <span className={`mchip prio-${pri}`}>{PRIORITY_LABEL[pri] ?? 'P1'}</span>
            </div>
            {cols.map((c) => {
              const items = tasks.filter((t) => t.priority === pri && colKey(t) === c.key)
              const hot = pri === 'high' && c.kind === 'overdue' && items.length > 0
              return (
                <div
                  key={c.key}
                  className={`umx-cell ${c.kind === 'overdue' ? 'od' : ''} ${c.diff === 0 ? 'today' : ''} ${hot ? 'hot' : ''}`}
                >
                  {items.map((t) => {
                    const d = dayDiffTZ(t.due_date)
                    const dueTag =
                      t.due_date == null
                        ? ''
                        : d !== null && d < 0
                          ? `逾期${-d}天`
                          : fmtMD(t.due_date)
                    return (
                      <button
                        type="button"
                        key={t.id}
                        className="umx-chip"
                        onClick={() => onOpen(t.id)}
                        title={t.title}
                      >
                        <div className="umx-chip-top">
                          <span className="umx-id">#{t.id}</span>
                          {dueTag && (
                            <span className={`umx-due ${d !== null && d < 0 ? 'od' : ''}`}>
                              {dueTag}
                            </span>
                          )}
                        </div>
                        <div className="umx-chip-bot">
                          <span className="umx-nm">{t.title}</span>
                          {t.assignee && <UserAvatar user={t.assignee} size={18} />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
