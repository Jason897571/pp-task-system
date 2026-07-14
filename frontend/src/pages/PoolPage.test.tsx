import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { App as AntApp } from 'antd'
import type { Task } from '../api/types'

// Mock the API so PoolPage's queries resolve without a backend.
vi.mock('../api/endpoints', () => ({
  getBoards: vi.fn(() => Promise.resolve([{ id: 1, name: '任务看板', position: 0 }])),
  getColumns: vi.fn(() => Promise.resolve([])),
  getPool: vi.fn(() =>
    Promise.resolve([
      {
        id: 100,
        title: '池任务',
        description: '',
        creator: { id: 1, full_name: '张三', role: 'admin', department_id: 1, avatar_attachment_id: null, card_color: null },
        assignee: null,
        department_id: 1,
        board_id: 1,
        column_id: null,
        lifecycle: 'open',
        is_rework: false,
        priority: 'high',
        is_mandatory: false,
        due_date: null,
        deleted_at: null,
        archived_at: null,
        completed_at: null,
        created_at: '',
        updated_at: '',
        tags: [],
        checklist_stats: { done: 0, total: 0 },
      } as Task,
    ]),
  ),
}))

import { PoolPage } from './PoolPage'

const VIEW_KEY = 'pool_view'

function renderPool() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AntApp>
          <PoolPage />
        </AntApp>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PoolPage view toggle persistence', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => localStorage.clear())

  it('persists the chosen view to localStorage when toggled', async () => {
    const user = userEvent.setup()
    renderPool()
    // Wait for the pool to load (toggle is rendered alongside).
    await waitFor(() => expect(screen.getByText('气泡')).toBeInTheDocument())

    // Default is bubble, so switching to list is the first state-changing toggle.
    await user.click(screen.getByText('列表'))
    expect(localStorage.getItem(VIEW_KEY)).toBe('list')

    await user.click(screen.getByText('气泡'))
    expect(localStorage.getItem(VIEW_KEY)).toBe('bubble')
  })

  it('initializes from localStorage on mount (bubble view → renders bubble field)', async () => {
    localStorage.setItem(VIEW_KEY, 'bubble')
    renderPool()
    await waitFor(() =>
      expect(document.querySelector('.bubble-field')).toBeInTheDocument(),
    )
  })
})
