import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Empty, Modal, Select, Spin, Table } from 'antd'
import { getBoards, getMemberStats, getStatsOverview, getTasks } from '../api/endpoints'
import type { MemberStats, Task } from '../api/types'

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div
      style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 18px',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 700, color: accent ?? '#fff' }}>{value}</div>
      <div style={{ color: 'var(--subtle)', fontSize: 13 }}>{label}</div>
    </div>
  )
}

function OverviewSection({ boardId }: { boardId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stats-overview', boardId],
    queryFn: () => getStatsOverview(boardId),
  })

  if (isLoading || !data) return <Spin />

  const maxCount = Math.max(1, ...data.by_column.map((c) => c.count))

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        {data.by_column.map((c) => (
          <StatCard key={c.column_id} label={c.name} value={c.count} />
        ))}
        <StatCard label="任务池" value={data.pool_count} accent="#579dff" />
        <StatCard label="逾期" value={data.overdue_count} accent="#f87168" />
      </div>

      {/* Simple bar chart of per-column counts. */}
      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--line)',
          borderRadius: 10,
          padding: 16,
          maxWidth: 640,
        }}
      >
        {data.by_column.map((c) => (
          <div key={c.column_id} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
            <div style={{ width: 90, color: 'var(--subtle)', fontSize: 13, textAlign: 'right' }}>
              {c.name}
            </div>
            <div style={{ flex: 1, background: '#ffffff14', borderRadius: 4, height: 18 }}>
              <div
                style={{
                  width: `${(c.count / maxCount) * 100}%`,
                  background: 'var(--blue)',
                  height: '100%',
                  borderRadius: 4,
                  minWidth: c.count > 0 ? 2 : 0,
                }}
              />
            </div>
            <div style={{ width: 30, color: 'var(--text)' }}>{c.count}</div>
          </div>
        ))}
      </div>
    </>
  )
}

// 统计面板页 (admin / super_admin) — spec §6.
export function StatsPage() {
  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })
  const [boardId, setBoardId] = useState<number | undefined>()
  const [memberTask, setMemberTask] = useState<MemberStats | null>(null)
  const effectiveBoardId = boardId ?? boards[0]?.id

  const { data: members = [] } = useQuery({
    queryKey: ['stats-members'],
    queryFn: getMemberStats,
  })

  const { data: memberTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['member-tasks', memberTask?.user.id],
    queryFn: () => getTasks({ assignee: memberTask!.user.id }),
    enabled: memberTask !== null,
  })

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#fff' }}>📊 统计面板</h2>
        <Select
          placeholder="选择看板"
          style={{ width: 200 }}
          value={effectiveBoardId}
          onChange={setBoardId}
          options={boards.map((b) => ({ value: b.id, label: b.name }))}
        />
      </div>

      {effectiveBoardId ? <OverviewSection boardId={effectiveBoardId} /> : <Empty description="暂无看板" />}

      <h3 style={{ color: '#fff', marginTop: 28 }}>人员统计</h3>
      <Table
        rowKey={(r) => r.user.id}
        pagination={false}
        dataSource={members}
        onRow={(r) => ({
          onClick: () => setMemberTask(r),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '姓名', key: 'name', render: (_: unknown, r: MemberStats) => r.user.full_name },
          { title: '总数', dataIndex: 'total' },
          { title: '已完成', dataIndex: 'done' },
          { title: '审核中', dataIndex: 'in_review' },
          {
            title: '逾期',
            dataIndex: 'overdue',
            render: (n: number) => (n > 0 ? <span style={{ color: '#f87168' }}>{n}</span> : n),
          },
        ]}
      />

      <Modal
        title={memberTask ? `${memberTask.user.full_name} 的任务` : ''}
        open={memberTask !== null}
        footer={null}
        onCancel={() => setMemberTask(null)}
        width={680}
      >
        {tasksLoading ? (
          <Spin />
        ) : (
          <Table
            rowKey="id"
            pagination={false}
            dataSource={memberTasks}
            columns={[
              { title: '标题', dataIndex: 'title' },
              {
                title: '优先级',
                dataIndex: 'priority',
                render: (p: Task['priority']) => (p === 'high' ? '高' : p === 'low' ? '低' : '普通'),
              },
              {
                title: '截止',
                dataIndex: 'due_date',
                render: (d: string | null) => (d ? new Date(d).toLocaleString('zh-CN') : '—'),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  )
}
