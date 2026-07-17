import { Fragment } from 'react'
import type { Task } from '../api/types'
import { PRIORITY_LABEL } from '../lib/badges'
import { dayDiffTZ } from '../lib/tz'
import { UserAvatar } from './UserAvatar'

// Urgency matrix: priority (rows) × time-to-DDL (columns). A task lands in one
// cell, so the top-left P0 × 已逾期 cell is "drop everything". Uses each task's
// priority + due_date — no backend data needed.

const BUCKETS: { key: string; label: string; test: (n: number | null) => boolean }[] = [
  { key: 'overdue', label: '已逾期', test: (n) => n !== null && n < 0 },
  { key: 'today', label: '今天', test: (n) => n === 0 },
  { key: 'week', label: '本周', test: (n) => n !== null && n > 0 && n <= 7 },
  { key: 'month', label: '本月', test: (n) => n !== null && n > 7 && n <= 31 },
  { key: 'later', label: '以后', test: (n) => n !== null && n > 31 },
  { key: 'none', label: '无期限', test: (n) => n === null },
]
const PRIS = ['high', 'normal', 'low'] as const

export function UrgencyMatrix({
  tasks,
  onOpen,
}: {
  tasks: Task[]
  onOpen: (id: number) => void
}) {
  const bucketOf = (t: Task) => BUCKETS.findIndex((b) => b.test(dayDiffTZ(t.due_date)))
  const counts = BUCKETS.map((_, ci) => tasks.filter((t) => bucketOf(t) === ci).length)

  return (
    <div className="umx-scroll">
      <div className="umx">
        <div className="umx-h umx-corner" />
        {BUCKETS.map((b, ci) => (
          <div key={b.key} className={`umx-h ${b.key === 'overdue' ? 'od' : ''}`}>
            {b.label}
            {counts[ci] > 0 && <span className="umx-cnt"> · {counts[ci]}</span>}
          </div>
        ))}

        {PRIS.map((pri) => (
          <Fragment key={pri}>
            <div className="umx-rl">
              <span className={`mchip prio-${pri}`}>{PRIORITY_LABEL[pri] ?? 'P1'}</span>
            </div>
            {BUCKETS.map((b, ci) => {
              const items = tasks.filter((t) => t.priority === pri && bucketOf(t) === ci)
              const hot = pri === 'high' && b.key === 'overdue' && items.length > 0
              return (
                <div
                  key={b.key}
                  className={`umx-cell ${b.key === 'overdue' ? 'od' : ''} ${hot ? 'hot' : ''}`}
                >
                  {items.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className="umx-chip"
                      onClick={() => onOpen(t.id)}
                      title={t.title}
                    >
                      <span className="umx-id">#{t.id}</span>
                      <span className="umx-nm">{t.title}</span>
                      {t.assignee && <UserAvatar user={t.assignee} size={18} />}
                    </button>
                  ))}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
