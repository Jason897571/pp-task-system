import { useNavigate } from 'react-router-dom'
import { Badge, Button, Dropdown, Empty } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api/endpoints'
import type { Notification } from '../api/types'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

// Top-bar bell with unread badge; polls every 30s (spec §通知).
export function NotificationBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: getNotifications,
    refetchInterval: 30_000,
  })

  const unread = notifications.filter((n) => !n.is_read).length

  const readM = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const readAllM = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const onClick = (n: Notification) => {
    if (!n.is_read) readM.mutate(n.id)
    if (n.related_task_id) {
      navigate(`/board/card/${n.related_task_id}`)
    }
  }

  const list = (
    <div className="notif-panel">
      <div className="notif-head">
        <span>通知</span>
        <Button type="link" size="small" disabled={unread === 0} onClick={() => readAllM.mutate()}>
          全部已读
        </Button>
      </div>
      <div className="notif-list">
        {notifications.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无通知" />
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`notif-item ${n.is_read ? '' : 'unread'}`}
              onClick={() => onClick(n)}
            >
              <div className="notif-msg">{n.message}</div>
              <div className="notif-time">{timeAgo(n.created_at)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <Dropdown popupRender={() => list} trigger={['click']} placement="bottomRight">
      <span className="notif-bell" title="通知">
        <Badge count={unread} size="small" offset={[-2, 2]}>
          <span style={{ fontSize: 18, cursor: 'pointer' }}>🔔</span>
        </Badge>
      </span>
    </Dropdown>
  )
}
