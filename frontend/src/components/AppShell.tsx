import { useRef, useState, type CSSProperties } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dropdown, Input, Modal, Popconfirm, Popover, App as AntApp } from 'antd'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useAuth } from '../auth/AuthContext'
import {
  createBoard,
  deleteBoard,
  getBoards,
  getTasks,
  reorderBoards,
  updateBoard,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Board } from '../api/types'
import { UserAvatar } from './UserAvatar'
import { SettingsModal } from './SettingsModal'
import { NotificationBell } from './NotificationBell'

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const { message } = AntApp.useApp()

  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })

  // Pending-approval count for the sidebar badge (scoped per role by the backend).
  const { data: pendingTasks = [] } = useQuery({
    queryKey: ['tasks', 'pending_approval'],
    queryFn: () => getTasks({ lifecycle: 'pending_approval' }),
  })

  // Search: local state drives the input (so IME composition isn't interrupted by
  // a value reset); the query is pushed to ?q= only when not mid-composition.
  const [searchText, setSearchText] = useState(searchParams.get('q') ?? '')
  const composing = useRef(false)
  const pushQuery = (q: string) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (q) next.set('q', q)
        else next.delete('q')
        return next
      },
      { replace: true },
    )

  const [newBoardOpen, setNewBoardOpen] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const isSuper = user?.role === 'super_admin'

  const deleteBoardM = useMutation({
    mutationFn: (id: number) => deleteBoard(id),
    onSuccess: (_r, id) => {
      message.success('看板已删除')
      const remaining = boards.filter((b) => b.id !== id)
      qc.setQueryData<Board[]>(['boards'], remaining)
      qc.invalidateQueries({ queryKey: ['boards'] })
      if (activeBoardId === id) {
        navigate(remaining.length ? `/board/${remaining[0].id}` : '/board')
      }
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const setIconM = useMutation({
    mutationFn: ({ id, icon }: { id: number; icon: string }) => updateBoard(id, { icon }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards'] }),
    onError: (e) => message.error(errMessage(e)),
  })

  const renameBoardM = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => updateBoard(id, { name }),
    onSuccess: () => {
      message.success('看板已改名')
      // Refresh boards (sidebar) and any open board's columns — the archive
      // board re-reads its per-source column names from the live board name.
      qc.invalidateQueries({ queryKey: ['boards'] })
      qc.invalidateQueries({ queryKey: ['columns'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const reorderM = useMutation({
    mutationFn: (ids: number[]) => reorderBoards(ids),
    onError: (e) => {
      message.error(errMessage(e))
      qc.invalidateQueries({ queryKey: ['boards'] })
    },
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const onBoardDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = boards.findIndex((b) => b.id === active.id)
    const newIndex = boards.findIndex((b) => b.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(boards, oldIndex, newIndex)
    qc.setQueryData<Board[]>(['boards'], next) // optimistic
    reorderM.mutate(next.map((b) => b.id))
  }

  // Archive board is pinned at the bottom, never draggable or deletable.
  const normalBoards = boards.filter((b) => !b.is_archive)
  const archiveBoard = boards.find((b) => b.is_archive)

  const activeBoardId = (() => {
    const m = location.pathname.match(/^\/board\/(\d+)/)
    return m ? Number(m[1]) : null
  })()

  const isPool = location.pathname.startsWith('/pool')
  const isApprovals = location.pathname.startsWith('/approvals')
  const isAdmin = location.pathname.startsWith('/admin')
  const isRecurring = location.pathname.startsWith('/recurring')
  const isStats = location.pathname.startsWith('/stats')
  const isTrash = location.pathname.startsWith('/trash')
  const isManager = user?.role === 'admin' || user?.role === 'super_admin'

  return (
    <>
      <div className="topbar">
        <span className="logo" onClick={() => navigate('/board')}>
          <span className="dot" />
          PP API任务系统
        </span>
        <Input
          className="topbar-search"
          placeholder="搜索当前看板：卡片 / 负责人"
          style={{ width: 260, marginLeft: 10 }}
          size="small"
          allowClear
          value={searchText}
          onChange={(e) => {
            const v = e.target.value
            setSearchText(v)
            // While an IME is composing, hold off pushing to the URL (it would
            // re-render and break composition). compositionEnd flushes it.
            if (!composing.current) pushQuery(v)
          }}
          onCompositionStart={() => {
            composing.current = true
          }}
          onCompositionEnd={(e) => {
            composing.current = false
            pushQuery((e.target as HTMLInputElement).value)
          }}
        />
        <span className="spacer" />
        <NotificationBell />
        {/* TODO: 创建 button opens a global task-create modal (deferred to per-column add). */}
        <Dropdown
          menu={{
            items: [
              { key: 'settings', label: '个人设置', onClick: () => setSettingsOpen(true) },
              { key: 'logout', label: '退出登录', onClick: logout },
            ],
          }}
          placement="bottomRight"
        >
          <span style={{ cursor: 'pointer', display: 'inline-flex' }} title={user?.full_name}>
            <UserAvatar user={user} size={28} />
          </span>
        </Dropdown>
      </div>

      <div className="app-body">
        <div className="sidebar">
          <div className="grp">看板</div>
          {isSuper ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onBoardDragEnd}
            >
              <SortableContext
                items={normalBoards.map((b) => b.id)}
                strategy={verticalListSortingStrategy}
              >
                {normalBoards.map((b) => (
                  <SortableBoardItem
                    key={b.id}
                    board={b}
                    active={activeBoardId === b.id}
                    onOpen={() => navigate(`/board/${b.id}`)}
                    onDelete={() => deleteBoardM.mutate(b.id)}
                    onSetIcon={(icon) => setIconM.mutate({ id: b.id, icon })}
                    onRename={(name) => renameBoardM.mutate({ id: b.id, name })}
                  />
                ))}
              </SortableContext>
            </DndContext>
          ) : (
            normalBoards.map((b) => (
              <button
                key={b.id}
                className={`nav-item ${activeBoardId === b.id ? 'active' : ''}`}
                onClick={() => navigate(`/board/${b.id}`)}
              >
                {b.icon || '📋'} {b.name}
              </button>
            ))
          )}
          {isSuper && (
            <button className="nav-item" onClick={() => setNewBoardOpen(true)}>
              + 新建看板
            </button>
          )}
          {archiveBoard && (
            <button
              className={`nav-item ${activeBoardId === archiveBoard.id ? 'active' : ''}`}
              onClick={() => navigate(`/board/${archiveBoard.id}`)}
            >
              🗄️ {archiveBoard.name}
            </button>
          )}
          {isManager && (
            <button
              className={`nav-item ${isTrash ? 'active' : ''}`}
              onClick={() => navigate('/trash')}
            >
              🗑️ 回收箱
            </button>
          )}

          <div className="grp">导航</div>
          <button
            className={`nav-item ${isPool ? 'active' : ''}`}
            onClick={() => navigate('/pool')}
          >
            🫧 任务池
          </button>
          <button
            className={`nav-item ${isApprovals ? 'active' : ''}`}
            onClick={() => navigate('/approvals')}
          >
            📥 待审批{pendingTasks.length > 0 ? ` (${pendingTasks.length})` : ''}
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

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  )
}

// Emoji palette super_admin picks a board icon from.
const BOARD_ICONS = [
  '📋', '📁', '📊', '📈', '🎯', '🚀', '💼', '🛠',
  '🧩', '📌', '🗂', '✅', '🔥', '⭐', '💡', '📦',
  '🏷', '📝', '🔧', '🎨', '🧪', '🔔', '📅', '💬',
]

interface SortableBoardItemProps {
  board: Board
  active: boolean
  onOpen: () => void
  onDelete: () => void
  onSetIcon: (icon: string) => void
  onRename: (name: string) => void
}

function SortableBoardItem({ board, active, onOpen, onDelete, onSetIcon, onRename }: SortableBoardItemProps) {
  const [iconOpen, setIconOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(board.name)

  const startEdit = () => {
    setDraftName(board.name)
    setEditing(true)
  }
  const commitEdit = () => {
    const next = draftName.trim()
    if (next && next !== board.name) onRename(next)
    setEditing(false)
  }
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: board.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
  }
  const iconGrid = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 4, width: 260 }}>
      {BOARD_ICONS.map((emo) => (
        <span
          key={emo}
          onClick={() => {
            onSetIcon(emo)
            setIconOpen(false)
          }}
          style={{
            cursor: 'pointer',
            fontSize: 18,
            textAlign: 'center',
            padding: '4px 0',
            borderRadius: 6,
            background: (board.icon || '📋') === emo ? 'rgba(255,255,255,0.12)' : 'transparent',
          }}
        >
          {emo}
        </span>
      ))}
    </div>
  )
  return (
    <div ref={setNodeRef} style={style} className={`nav-item board-item ${active ? 'active' : ''}`}>
      <Popover
        open={iconOpen}
        onOpenChange={setIconOpen}
        trigger="click"
        placement="rightTop"
        title="选择图标"
        content={iconGrid}
      >
        <span
          title="点击更换图标"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ cursor: 'pointer', padding: '0 2px' }}
        >
          {board.icon || '📋'}
        </span>
      </Popover>
      {editing ? (
        <Input
          size="small"
          autoFocus
          variant="borderless"
          style={{ flex: 1, minWidth: 0, marginLeft: 4, padding: '0 4px', height: 22 }}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onPressEnter={commitEdit}
          onBlur={commitEdit}
          onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          style={{ flex: 1, cursor: 'grab', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', marginLeft: 4 }}
          title="双击改名"
          onClick={onOpen}
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
          {...attributes}
          {...listeners}
        >
          {board.name}
        </span>
      )}
      <Popconfirm
        title="删除看板"
        description={`确定删除「${board.name}」？其卡片将一并删除。`}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onConfirm={onDelete}
      >
        <span
          className="board-del"
          title="删除看板"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          style={{ padding: '0 4px', opacity: 0.6, cursor: 'pointer' }}
        >
          🗑
        </span>
      </Popconfirm>
    </div>
  )
}
