import type { ColumnKind, Task } from '../api/types'
import { avatarColor, dueLabel, dueState, initial } from '../lib/badges'

// Card front per spec §7.3: title, priority badge, due badge, rework badge, assignee avatar.
export function CardFront({ task, columnKind }: { task: Task; columnKind: ColumnKind }) {
  const due = dueState(task.due_date, columnKind)
  const badges: React.ReactNode[] = []

  if (task.due_date && due) {
    badges.push(
      <span key="due" className={`badge due ${due}`}>
        🕒 {dueLabel(task.due_date)}
      </span>,
    )
  }
  if (task.is_mandatory) {
    badges.push(
      <span key="must" className="badge must">
        🔁 必做
      </span>,
    )
  }
  if (task.is_rework) {
    badges.push(
      <span key="rework" className="badge rework">
        ↩ 重做
      </span>,
    )
  }
  if (task.priority === 'high') {
    badges.push(
      <span key="prio" className="badge prio-high">
        ⬆ 高
      </span>,
    )
  }
  if (task.description) {
    badges.push(
      <span key="desc" className="badge">
        📝
      </span>,
    )
  }

  return (
    <>
      <div className="card-title">{task.title}</div>
      {badges.length > 0 && <div className="badges">{badges}</div>}
      {task.assignee && (
        <div className="card-foot">
          <span
            className="av-sm"
            style={{ background: avatarColor(task.assignee.id) }}
            title={task.assignee.full_name}
          >
            {initial(task.assignee.full_name)}
          </span>
        </div>
      )}
    </>
  )
}
