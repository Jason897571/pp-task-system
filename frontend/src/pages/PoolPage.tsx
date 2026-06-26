import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Empty, Segmented, Select, Spin, Table, Tag } from 'antd'
import { getBoards, getColumns, getPool } from '../api/endpoints'
import { CardDetailModal } from '../components/CardDetailModal'
import { PoolBubbles } from '../components/PoolBubbles'
import type { Task } from '../api/types'

type PoolView = 'list' | 'bubble'
const VIEW_KEY = 'pool_view'

function loadView(): PoolView {
  return localStorage.getItem(VIEW_KEY) === 'bubble' ? 'bubble' : 'list'
}

// Task Pool — list view + floating-bubble view (spec §6b), choice persisted in localStorage.
export function PoolPage() {
  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })
  // 'all' (default) aggregates every visible board's pool into one list.
  const [boardId, setBoardId] = useState<number | 'all'>('all')
  const [openTaskId, setOpenTaskId] = useState<number | null>(null)
  const [view, setView] = useState<PoolView>(loadView)

  const { data: pool = [], isLoading } = useQuery({
    queryKey: ['pool', boardId],
    queryFn: () => getPool(boardId === 'all' ? undefined : boardId),
  })

  // Columns are only needed to resolve a card's column label; pool tasks have
  // none, so the aggregated view can skip the fetch entirely.
  const { data: columns = [] } = useQuery({
    queryKey: ['columns', boardId],
    queryFn: () => getColumns(boardId as number),
    enabled: boardId !== 'all',
  })

  const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? '—'

  const changeView = (v: PoolView) => {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

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
          value={boardId}
          onChange={setBoardId}
          options={[
            { value: 'all', label: '全部看板' },
            ...boards.map((b) => ({ value: b.id, label: b.name })),
          ]}
        />
        <Segmented
          value={view}
          onChange={(v) => changeView(v as PoolView)}
          options={[
            { value: 'list', label: '列表' },
            { value: 'bubble', label: '气泡' },
          ]}
        />
      </div>

      {isLoading ? (
        <Spin />
      ) : pool.length === 0 ? (
        <Empty description="任务池为空" />
      ) : view === 'bubble' ? (
        <PoolBubbles tasks={pool} onOpen={setOpenTaskId} />
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
