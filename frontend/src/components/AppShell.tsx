import { useRef, useState, type CSSProperties } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Dropdown, Input, Modal, Popconfirm, App as AntApp } from 'antd'
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
import { createBoard, deleteBoard, getBoards, reorderBoards } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Board } from '../api/types'
import { avatarColor, initial } from '../lib/badges'
import { NotificationBell } from './NotificationBell'

export function AppShell() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()
  const { message } = AntApp.useApp()

  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })

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
                📋 {b.name}
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

interface SortableBoardItemProps {
  board: Board
  active: boolean
  onOpen: () => void
  onDelete: () => void
}

function SortableBoardItem({ board, active, onOpen, onDelete }: SortableBoardItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: board.id })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
  }
  return (
    <div ref={setNodeRef} style={style} className={`nav-item board-item ${active ? 'active' : ''}`}>
      <span
        style={{ flex: 1, cursor: 'grab', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
        onClick={onOpen}
        {...attributes}
        {...listeners}
      >
        📋 {board.name}
      </span>
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
