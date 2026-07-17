import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Empty, Popconfirm, Spin, Table, Tag, App as AntApp } from 'antd'
import dayjs from 'dayjs'
import { getBoards, getTrash, purgeTask, restoreCard } from '../api/endpoints'
import { errMessage } from '../api/client'
import { fmtDateTime } from '../lib/tz'
import type { Task } from '../api/types'

const RETENTION_DAYS = 30

// Days until a trashed card is auto-purged (30 days after deletion).
function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return RETENTION_DAYS
  const left = dayjs(deletedAt).add(RETENTION_DAYS, 'day').diff(dayjs(), 'day')
  return Math.max(0, left)
}

// Recycle bin — deleted cards kept 30 days, then auto-removed. Admin/super only.
export function TrashPage() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { data: trash = [], isLoading } = useQuery({ queryKey: ['trash'], queryFn: getTrash })
  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })

  const boardName = (id: number) => boards.find((b) => b.id === id)?.name ?? '—'

  const restoreM = useMutation({
    mutationFn: (id: number) => restoreCard(id),
    onSuccess: () => {
      message.success('已恢复到原看板')
      qc.invalidateQueries({ queryKey: ['trash'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const purgeM = useMutation({
    mutationFn: (id: number) => purgeTask(id),
    onSuccess: () => {
      message.success('已彻底删除')
      qc.invalidateQueries({ queryKey: ['trash'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const columns = [
    { title: '标题', dataIndex: 'title', key: 'title' },
    { title: '看板', key: 'board', render: (_: unknown, r: Task) => boardName(r.board_id) },
    {
      title: '删除时间',
      dataIndex: 'deleted_at',
      key: 'deleted_at',
      render: (d: string | null) => (d ? fmtDateTime(d) : '—'),
    },
    {
      title: '剩余',
      key: 'left',
      render: (_: unknown, r: Task) => {
        const n = daysLeft(r.deleted_at)
        return <Tag color={n <= 3 ? 'red' : 'default'}>{n} 天后自动删除</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, r: Task) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" loading={restoreM.isPending} onClick={() => restoreM.mutate(r.id)}>
            ↩ 恢复
          </Button>
          <Popconfirm
            title="彻底删除？"
            description="此操作不可撤销，卡片及其附件、清单、产出将被永久删除。"
            okText="彻底删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => purgeM.mutate(r.id)}
          >
            <Button size="small" danger>
              彻底删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  return (
    <div className="page-pad">
      <h2 style={{ marginTop: 0, color: '#fff' }}>🗑️ 回收箱</h2>
      <p style={{ color: 'var(--subtle)', marginTop: -6, marginBottom: 16 }}>
        删除的卡片会保留 {RETENTION_DAYS} 天，到期自动永久删除。可随时恢复到原看板。
      </p>
      {isLoading ? (
        <Spin />
      ) : trash.length === 0 ? (
        <Empty description="回收箱是空的" />
      ) : (
        <Table rowKey="id" dataSource={trash} columns={columns} pagination={false} />
      )}
    </div>
  )
}
