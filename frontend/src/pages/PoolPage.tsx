import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Empty, Select, Spin, Table, Tag } from 'antd'
import { getBoards, getColumns, getPool } from '../api/endpoints'
import { CardDetailModal } from '../components/CardDetailModal'
import type { Task } from '../api/types'

// Task Pool — list view only (floating-bubble view is deferred, spec §6b).
export function PoolPage() {
  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })
  const [boardId, setBoardId] = useState<number | undefined>()
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)

  const effectiveBoardId = boardId ?? boards[0]?.id

  const { data: pool = [], isLoading } = useQuery({
    queryKey: ['pool', effectiveBoardId],
    queryFn: () => getPool(effectiveBoardId!),
    enabled: !!effectiveBoardId,
  })

  // Columns needed by the modal to resolve column kind (pool tasks have none, but
  // the modal reads from this list defensively).
  const { data: columns = [] } = useQuery({
    queryKey: ['columns', effectiveBoardId],
    queryFn: () => getColumns(effectiveBoardId!),
    enabled: !!effectiveBoardId,
  })

  const columnsDef = [
    { title: '标题', dataIndex: 'title', key: 'title' },
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
    {
      title: '截止',
      dataIndex: 'due_date',
      key: 'due_date',
      render: (d: string | null) => (d ? new Date(d).toLocaleString('zh-CN') : '—'),
    },
  ]

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#fff' }}>🫧 任务池</h2>
        <Select
          placeholder="选择看板"
          style={{ width: 200 }}
          value={effectiveBoardId}
          onChange={setBoardId}
          options={boards.map((b) => ({ value: b.id, label: b.name }))}
        />
      </div>

      {isLoading ? (
        <Spin />
      ) : pool.length === 0 ? (
        <Empty description="任务池为空" />
      ) : (
        <Table
          rowKey="id"
          dataSource={pool}
          columns={columnsDef}
          pagination={false}
          onRow={(r) => ({ onClick: () => setOpenTaskId(r.id), style: { cursor: 'pointer' } })}
        />
      )}

      {openTaskId !== null && (
        <CardDetailModal
          taskId={openTaskId}
          columns={columns}
          onClose={() => setOpenTaskId(null)}
        />
      )}
    </div>
  )
}
