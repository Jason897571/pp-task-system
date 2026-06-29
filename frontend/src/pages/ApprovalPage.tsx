import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Empty, Spin, Table, Tag } from 'antd'
import { getBoards, getTasks } from '../api/endpoints'
import { CardDetailModal } from '../components/CardDetailModal'
import type { Task } from '../api/types'

// 待审批 — member self-submitted tasks (lifecycle=pending_approval). The backend
// scopes the list per role: managers see their department's pending tasks (and
// approve them in the card), members see only the ones they created (read-only).
export function ApprovalPage() {
  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)

  const { data: pending = [], isLoading } = useQuery({
    queryKey: ['tasks', 'pending_approval'],
    queryFn: () => getTasks({ lifecycle: 'pending_approval' }),
  })

  const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? '—'

  const columnsDef = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    {
      title: '看板',
      key: 'board',
      render: (_: unknown, r: Task) => boardName(r.board_id),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      render: (p: Task['priority']) =>
        p === 'high' ? <Tag color="red">高</Tag> : p === 'low' ? <Tag>低</Tag> : <Tag>普通</Tag>,
    },
    {
      title: '创建人',
      key: 'creator',
      render: (_: unknown, r: Task) => r.creator.full_name,
    },
  ]

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#fff' }}>📥 待审批</h2>
      </div>

      {isLoading ? (
        <Spin />
      ) : pending.length === 0 ? (
        <Empty description="暂无待审批任务" />
      ) : (
        <Table
          rowKey="id"
          dataSource={pending}
          columns={columnsDef}
          pagination={false}
          onRow={(r) => ({ onClick: () => setOpenTaskId(r.id), style: { cursor: 'pointer' } })}
        />
      )}

      {openTaskId !== null && (
        <CardDetailModal taskId={openTaskId} columns={[]} onClose={() => setOpenTaskId(null)} />
      )}
    </div>
  )
}
