import type { Task } from '../api/types'

// One week's worth of archived cards, for the 归档看板「按周」view.
export interface WeekGroup {
  key: string // Monday's date 'YYYY-MM-DD', or 'earlier' for undated cards
  label: string // 'MM-DD ~ MM-DD', or '更早'
  isCurrent: boolean // the week containing `now`
  tasks: Task[]
}

// Monday-based start of the week containing `d` (local time).
function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // Mon=0 … Sun=6
  x.setDate(x.getDate() - dow)
  return x
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const md = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// Group archived tasks into weeks by archived_at, newest week first. Cards with
// no (or invalid) archived_at fall into a trailing '更早' bucket.
export function groupByWeek(tasks: Task[], now: Date = new Date()): WeekGroup[] {
  const currentKey = ymd(weekStart(now))
  const buckets = new Map<string, Task[]>()
  const earlier: Task[] = []

  for (const t of tasks) {
    const d = t.archived_at ? new Date(t.archived_at) : null
    if (!d || isNaN(d.getTime())) {
      earlier.push(t)
      continue
    }
    const key = ymd(weekStart(d))
    const bucket = buckets.get(key)
    if (bucket) bucket.push(t)
    else buckets.set(key, [t])
  }

  const groups: WeekGroup[] = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // newest week first
    .map(([key, ts]) => {
      const start = new Date(`${key}T00:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      return {
        key,
        label: `${md(start)} ~ ${md(end)}`,
        isCurrent: key === currentKey,
        // within a week, most-recently-archived first
        tasks: [...ts].sort((a, b) => (a.archived_at! < b.archived_at! ? 1 : -1)),
      }
    })

  if (earlier.length) {
    groups.push({ key: 'earlier', label: '更早', isCurrent: false, tasks: earlier })
  }
  return groups
}
