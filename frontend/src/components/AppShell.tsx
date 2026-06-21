import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dropdown, Input, Modal, App as AntApp } from 'antd'
import { useAuth } from '../auth/AuthContext'
import { createBoard, getBoards } from '../api/endpoints'
import { errMessage } from '../api/client'
import { avatarColor, initial } from '../lib/badges'
import { NotificationBell } from './NotificationBell'

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { message } = AntApp.useApp()

  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })

  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const createBoardM = useMutation({
    mutationFn: () => createBoard(newBoardName.trim()),
    onSuccess: (board) => {
      message.success(`看板「${board.name}」已创建`)
      qc.invalidateQueries({ queryKey: ['boards'] })
      setNewBoardOpen(false)
      setNewBoardName('')
      navigate(`/board/${board.id}`)
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const activeBoardId = (() => {
    const m = location.pathname.match(/^\/board\/(\d+)/)
    return m ? Number(m[1]) : null
  })()

  const isPool = location.pathname.startsWith('/pool')
  const isAdmin = location.pathname.startsWith('/admin')
  const isRecurring = location.pathname.startsWith('/recurring')
  const isStats = location.pathname.startsWith('/stats')
  const isManager = user?.role === 'admin' || user?.role === 'super_admin'

  return (
    <>
      <div className="topbar">
        <span className="logo" onClick={() => navigate('/board')}>
          <span className="dot" />
          任务系统
        </span>
        <Input
          className="topbar-search"
          placeholder="搜索卡片 / 负责人 / 标签"
          style={{ width: 240, marginLeft: 10 }}
          size="small"
          // TODO: wire global search once backend supports a search endpoint.
        />
        <span className="spacer" />
        <NotificationBell />
        {/* TODO: 创建 button opens a global task-create modal (deferred to per-column add). */}
        <Dropdown
          menu={{
            items: [{ key: 'logout', label: '退出登录', onClick: logout }],
          }}
          placement="bottomRight"
        >
          <span
            className="av-sm"
            style={{
              background: avatarColor(user?.id ?? 0),
              width: 28,
              height: 28,
              cursor: 'pointer',
            }}
            title={user?.full_name}
          >
            {initial(user?.full_name ?? '?')}
          </span>
        </Dropdown>
      </div>

      <div className="app-body">
        <div className="sidebar">
          <div className="grp">看板</div>
          {boards.map((b) => (
            <button
              key={b.id}
              className={`nav-item ${activeBoardId === b.id ? 'active' : ''}`}
              onClick={() => navigate(`/board/${b.id}`)}
            >
              📋 {b.name}
            </button>
          ))}
          {user?.role === 'super_admin' && (
            <button className="nav-item" onClick={() => setNewBoardOpen(true)}>
              + 新建看板
            </button>
          )}

          <div className="grp">导航</div>
          <button
            className={`nav-item ${isPool ? 'active' : ''}`}
            onClick={() => navigate('/pool')}
          >
            🫧 任务池
          </button>
          {isManager && (
            <>
              <button
                className={`nav-item ${isRecurring ? 'active' : ''}`}
                onClick={() => navigate('/recurring')}
              >
                🔁 每周必做
              </button>
              <button
                className={`nav-item ${isStats ? 'active' : ''}`}
                onClick={() => navigate('/stats')}
              >
                📊 统计
              </button>
            </>
          )}
          {user?.role === 'super_admin' && (
            <button
              className={`nav-item ${isAdmin ? 'active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              ⚙ 管理
            </button>
          )}
        </div>

        <div className="main-area">
          <Outlet />
        </div>
      </div>

      <Modal
        title="新建看板"
        open={newBoardOpen}
        onCancel={() => setNewBoardOpen(false)}
        onOk={() => newBoardName.trim() && createBoardM.mutate()}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newBoardName.trim(), loading: createBoardM.isPending }}
      >
        <Input
          placeholder="看板名称（如：合同看板）"
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
          onPressEnter={() => newBoardName.trim() && createBoardM.mutate()}
          autoFocus
          maxLength={40}
        />
        <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: 12 }}>
          将自动创建默认列：待办 → 进行中 → 待审核 → 已完成
        </div>
      </Modal>
    </>
  )
}
