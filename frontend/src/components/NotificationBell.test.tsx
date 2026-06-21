import { describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Notification } from '../api/types'

const notifs: Notification[] = [
  { id: 1, type: 'assigned', message: '你被指派了', related_task_id: 5, is_read: false, created_at: new Date().toISOString() },
  { id: 2, type: 'review', message: '产出已提交', related_task_id: 6, is_read: false, created_at: new Date().toISOString() },
  { id: 3, type: 'done', message: '已通过', related_task_id: null, is_read: true, created_at: new Date().toISOString() },
]

vi.mock('../api/endpoints', () => ({
  getNotifications: vi.fn(() => Promise.resolve(notifs)),
  markNotificationRead: vi.fn(() => Promise.resolve({ ok: true })),
  markAllNotificationsRead: vi.fn(() => Promise.resolve({ ok: true })),
}))

import { NotificationBell } from './NotificationBell'

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('NotificationBell unread badge', () => {
  it('shows the count of unread notifications (2 of 3)', async () => {
    const { container } = renderBell()
    await waitFor(() => {
      const badge = container.querySelector('.ant-badge-count')
      expect(badge).toBeInTheDocument()
      expect(badge?.textContent).toBe('2')
    })
  })
})
