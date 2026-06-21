import type { ColumnKind, Task } from '../api/types'
import { avatarColor, dueLabel, dueState, initial } from '../lib/badges'

// Card front (spec §7.3). Layout: colored label pills → title → hairline
// divider → meta row (status chips on the left, assignee avatar on the right).
// A red left spine (drawn on .card via data-spine) flags high-priority cards.
export function CardFront({ task, columnKind }: { task: Task; columnKind: ColumnKind }) {
  const due = dueState(task.due_date, columnKind)
  const cs = task.checklist_stats
  const hasChecklist = !!cs && cs.total > 0
  const checklistDone = hasChecklist && cs.done === cs.total

  const chips: React.ReactNode[] = []
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
      <div className="card-title">{task.title}</div>
      {(chips.length > 0 || task.assignee) && (
        <>
          <div className="card-divider" />
          <div className="card-meta">
            <div className="meta-chips">{chips}</div>
            {task.assignee && (
              <span
                className="av-sm card-av"
                style={{ background: avatarColor(task.assignee.id) }}
                title={task.assignee.full_name}
              >
                {initial(task.assignee.full_name)}
              </span>
            )}
          </div>
        </>
      )}
    </>
  )
}
