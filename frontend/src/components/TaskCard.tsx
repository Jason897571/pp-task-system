import type { ColumnKind, Task } from '../api/types'
import { dueLabel, dueState, openTagLink, PRIORITY_LABEL, TAG_COLORS } from '../lib/badges'
import { UserAvatar } from './UserAvatar'

// Card front (spec §7.3). Layout: colored label pills → title → hairline
// divider → meta row (status chips on the left, assignee avatar on the right).
// A red left spine (drawn on .card via data-spine) flags high-priority cards.
export function CardFront({
  task,
  columnKind,
  isFinal = false,
}: {
  task: Task
  columnKind: ColumnKind
  isFinal?: boolean
}) {
  const due = dueState(task.due_date, columnKind)
  const cs = task.checklist_stats
  const hasChecklist = !!cs && cs.total > 0
  const checklistDone = hasChecklist && cs.done === cs.total

  const chips: React.ReactNode[] = []
  if (isFinal) {
    chips.push(
      <span key="done" className="mchip done">
        ✓ 已完成
      </span>,
    )
  }
  chips.push(
    <span key="prio" className={`mchip prio-${task.priority}`}>
      {PRIORITY_LABEL[task.priority] ?? 'P1'}
    </span>,
  )
  if (task.due_date && due) {
    chips.push(
      <span key="due" className={`mchip due-${due}`}>
        🕒 {dueLabel(task.due_date)}
      </span>,
    )
  }
  if (hasChecklist) {
    chips.push(
      <span key="cl" className={`mchip cl ${checklistDone ? 'cl-done' : ''}`}>
        ☑ {cs.done}/{cs.total}
      </span>,
    )
  }
  if (task.is_mandatory) {
    chips.push(
      <span key="must" className="mchip must">
        🔁 必做
      </span>,
    )
  }
  if (task.is_rework) {
    chips.push(
      <span key="rw" className="mchip rework">
        ↩ 重做
      </span>,
    )
  }
  if (task.description) {
    chips.push(
      <span key="desc" className="mchip ghost" title="有描述">
        📝
      </span>,
    )
  }

  return (
    <>
      {task.tags.length > 0 && (
        <div className="card-tags">
          {task.tags.map((t) => (
            <span
              key={t.id}
              className="tag-chip"
              style={{ background: TAG_COLORS[t.color], cursor: t.link ? 'pointer' : 'default' }}
              title={t.link ? `打开链接：${t.link}` : t.name}
              onClick={
                t.link
                  ? (e) => {
                      // Don't let the click bubble to the card (which opens the detail modal).
                      e.stopPropagation()
                      openTagLink(t)
                    }
                  : undefined
              }
            >
              {t.name}
              {t.link && ' 🔗'}
            </span>
          ))}
        </div>
      )}
      <div className="card-no" title="任务编号">#{task.id}</div>
      <div className="card-title">{task.title}</div>
      {(chips.length > 0 || task.assignee) && (
        <>
          <div className="card-divider" />
          <div className="card-meta">
            <div className="meta-chips">{chips}</div>
            {task.assignee && (
              <UserAvatar user={task.assignee} size={26} className="card-av" />
            )}
          </div>
        </>
      )}
    </>
  )
}
