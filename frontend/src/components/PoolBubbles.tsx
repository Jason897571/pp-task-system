import { useMemo } from 'react'
import type { Task } from '../api/types'

// Size & brightness scale with priority — high is bigger / brighter (spec §6b).
function bubbleStyle(priority: Task['priority']): { size: number; opacity: number } {
  switch (priority) {
    case 'high':
      return { size: 140, opacity: 1 }
    case 'low':
      return { size: 90, opacity: 0.6 }
    default:
      return { size: 110, opacity: 0.8 }
  }
}

// Floating-bubble view: each open task drifts slowly via CSS animation.
// Click a bubble → open the same task detail modal.
export function PoolBubbles({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: number) => void }) {
  // Stable per-task placement / timing so bubbles don't jump on re-render.
  const placed = useMemo(
    () =>
      tasks.map((t, i) => ({
        task: t,
        ...bubbleStyle(t.priority),
        left: (i * 137) % 80, // spread across the field (% of width)
        top: (i * 89) % 70,
        delay: -(i * 1.3), // negative delay so they start mid-animation
        duration: 9 + ((i * 3) % 7), // 9–15s drift
      })),
    [tasks],
  )

  return (
    <div className="bubble-field">
      {placed.map(({ task, size, opacity, left, top, delay, duration }) => (
        <div
          key={task.id}
          className="bubble"
          onClick={() => onOpen(task.id)}
          style={{
            width: size,
            height: size,
            left: `${left}%`,
            top: `${top}%`,
            opacity,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
          }}
          title={task.title}
        >
          <span className="bubble-title">{task.title}</span>
          {task.priority === 'high' && <span className="bubble-tag">⬆ 高</span>}
        </div>
      ))}
    </div>
  )
}
