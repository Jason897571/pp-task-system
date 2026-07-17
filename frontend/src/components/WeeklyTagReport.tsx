import type { WeeklyExportTask } from '../api/types'
import { PRIORITY_LABEL, PRIORITY_RANK } from '../lib/badges'

// Within a group, P0 first, then P1, then P2 (stable for equal priority).
const byPriority = (a: WeeklyExportTask, b: WeeklyExportTask) =>
  (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)

// The weekly report grouped by tag: one section per tag (colored pill + count +
// share bar), listing that tag's completed tasks. A task with several tags shows
// under each; tasks without a tag fall into 未分类.

const priClass = (p: string) => (p === 'high' ? 'P0' : p === 'low' ? 'P2' : 'P1')

function Row({ t, curTag }: { t: WeeklyExportTask; curTag?: string }) {
  const others = curTag ? t.tags.filter((x) => x !== curTag) : t.tags
  return (
    <div className="wr-row">
      <span className="wr-id">#{t.id}</span>
      <span className={`wr-pri ${priClass(t.priority)}`}>{PRIORITY_LABEL[t.priority] ?? 'P1'}</span>
      <span className="wr-tt">{t.title}</span>
      {others.length > 0 && <span className="wr-also">也属于 {others.join('·')}</span>}
      {t.assignee && <span className="wr-who">{t.assignee}</span>}
      {t.board && <span className="wr-brd">{t.board}</span>}
    </div>
  )
}

export function WeeklyTagReport({
  tasks,
  tagColor,
}: {
  tasks: WeeklyExportTask[]
  tagColor: (name: string) => string
}) {
  const total = tasks.length
  if (total === 0) return <div className="wr-empty">这一周暂无完成的任务</div>

  const groups = new Map<string, WeeklyExportTask[]>()
  const untagged: WeeklyExportTask[] = []
  for (const t of tasks) {
    if (t.tags.length === 0) untagged.push(t)
    else for (const tg of t.tags) groups.set(tg, [...(groups.get(tg) ?? []), t])
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="wr">
      {sorted.map(([name, items]) => {
        const pct = Math.round((items.length / total) * 100)
        const color = tagColor(name)
        return (
          <div className="wr-grp" key={name}>
            <div className="wr-grp-h">
              <span className="wr-pill" style={{ background: color }}>
                {name}
              </span>
              <span className="wr-cnt">{items.length} 项</span>
              <span className="wr-bar">
                <i style={{ width: `${pct}%`, background: color }} />
              </span>
              <span className="wr-pct">{pct}%</span>
            </div>
            {[...items].sort(byPriority).map((t) => (
              <Row key={t.id} t={t} curTag={name} />
            ))}
          </div>
        )
      })}
      {untagged.length > 0 && (
        <div className="wr-grp">
          <div className="wr-grp-h">
            <span className="wr-pill wr-none">未分类</span>
            <span className="wr-cnt">{untagged.length} 项</span>
          </div>
          {[...untagged].sort(byPriority).map((t) => (
            <Row key={t.id} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}
