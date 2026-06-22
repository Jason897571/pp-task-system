import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Empty, Spin, App as AntApp } from 'antd'
import {
  archiveNow,
  createColumn,
  createTask,
  deleteColumn,
  getBoards,
  getColumns,
  getTasks,
  moveTask,
  updateColumn,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { BoardColumnView } from '../components/BoardColumn'
import { RestoreModal } from '../components/RestoreModal'
import { PRIORITY_RANK } from '../lib/badges'
import { CardDetailModal } from '../components/CardDetailModal'
import { canDropInto } from '../lib/actions'
import type { BoardColumn, Task } from '../api/types'

export function BoardPage() {
  const { boardId: boardIdParam, taskId: taskIdParam } = useParams()
  const [searchParams] = useSearchParams()
  const q = (searchParams.get('q') ?? '').trim().toLowerCase()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { message } = AntApp.useApp()
  const qc = useQueryClient()

  const { data: boards = [] } = useQuery({ queryKey: ['boards'], queryFn: getBoards })

  // Default to first visible board when no id in URL.
  const boardId = boardIdParam ? Number(boardIdParam) : boards[0]?.id
  useEffect(() => {
    if (!boardIdParam && boards.length > 0) {
      navigate(`/board/${boards[0].id}`, { replace: true })
    }
  }, [boardIdParam, boards, navigate])

  const board = boards.find((b) => b.id === boardId)
  const isSuperAdmin = user?.role === 'super_admin'
  const isManager = user?.role === 'admin' || isSuperAdmin
  const isArchive = !!board?.is_archive
  const [restoreTask, setRestoreTask] = useState<Task | null>(null)

  const { data: columns = [], isLoading: colsLoading } = useQuery({
    queryKey: ['columns', boardId],
    queryFn: () => getColumns(boardId!),
    enabled: !!boardId,
  })

  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', boardId, 'on_board'],
    queryFn: () => getTasks({ board_id: boardId!, lifecycle: 'on_board' }),
    enabled: !!boardId,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const moveM = useMutation({
    mutationFn: ({ id, columnId }: { id: number; columnId: number }) => moveTask(id, columnId),
    onMutate: async ({ id, columnId }) => {
      // Optimistic: move the card locally.
      const key = ['tasks', boardId, 'on_board']
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Task[]>(key)
      qc.setQueryData<Task[]>(key, (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, column_id: columnId } : t)),
      )
      return { prev, key }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev)
      message.error(errMessage(err, '移动失败'))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks', boardId, 'on_board'] }),
  })

  const addCardM = useMutation({
    mutationFn: ({ colId, title }: { colId: number; title: string }) => {
      void colId // start column is resolved by backend; assignee handled per role.
      // admin: assign to self (lands on start). member: self-submit -> pending_approval.
      const body =
        user?.role === 'member'
          ? { title, board_id: boardId! }
          : { title, board_id: boardId!, assignee_id: user!.id }
      return createTask(body)
    },
    onSuccess: () => {
      message.success('已添加卡片')
      qc.invalidateQueries({ queryKey: ['tasks', boardId, 'on_board'] })
      qc.invalidateQueries({ queryKey: ['pool'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const renameColM = useMutation({
    mutationFn: ({ colId, name }: { colId: number; name: string }) =>
      updateColumn(colId, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['columns', boardId] }),
    onError: (e) => message.error(errMessage(e)),
  })

  const deleteColM = useMutation({
    mutationFn: (colId: number) => deleteColumn(colId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['columns', boardId] })
      qc.invalidateQueries({ queryKey: ['tasks', boardId, 'on_board'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const addColM = useMutation({
    mutationFn: (name: string) => createColumn(boardId!, { name, kind: null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['columns', boardId] }),
    onError: (e) => message.error(errMessage(e)),
  })

  const setFinalM = useMutation({
    mutationFn: ({ colId, isFinal }: { colId: number; isFinal: boolean }) =>
      updateColumn(colId, { is_final: isFinal }),
    onSuccess: (_d, { isFinal }) => {
      message.success(isFinal ? '已设为最终验收完成列' : '已取消最终验收')
      qc.invalidateQueries({ queryKey: ['columns', boardId] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const setReviewM = useMutation({
    mutationFn: ({ colId, requiresReview }: { colId: number; requiresReview: boolean }) =>
      updateColumn(colId, { requires_review: requiresReview }),
    onSuccess: (_d, { requiresReview }) => {
      message.success(requiresReview ? '已设为审核节点' : '已取消审核节点')
      qc.invalidateQueries({ queryKey: ['columns', boardId] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const archiveM = useMutation({
    mutationFn: archiveNow,
    onSuccess: ({ archived }) => {
      message.success(archived > 0 ? `已归档 ${archived} 张卡片` : '没有可归档的卡片')
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const onDragEnd = (e: DragEndEvent) => {
    const task = e.active.data.current?.task as Task | undefined
    const targetCol = e.over?.data.current?.col as BoardColumn | undefined
    if (!task || !targetCol || task.column_id === targetCol.id) return
    const boardHasReview = columns.some((c) => c.requires_review)
    const drop = canDropInto(targetCol, { role: user!.role, boardHasReview })
    if (!drop.ok) {
      message.warning(drop.reason ?? '无法移动到该列')
      return
    }
    moveM.mutate({ id: task.id, columnId: targetCol.id })
  }

  const openCard = (id: number) => navigate(`/board/${boardId}/card/${id}`)
  const closeCard = () => navigate(`/board/${boardId}`)

  const sorted = [...columns].sort((a, b) => a.position - b.position)

  // Top-bar search (?q=) filters the current board's cards by title or assignee.
  const matchesSearch = (t: Task) =>
    !q ||
    t.title.toLowerCase().includes(q) ||
    (t.assignee?.full_name.toLowerCase().includes(q) ?? false)
  const visibleTasks = tasks.filter(matchesSearch)

  // Cards within a column always sort by priority (P0 → P1 → P2); same priority
  // keeps its original order (stable). Memoized per column at render time below.
  const colTasks = (colId: number) =>
    visibleTasks
      .filter((t) => t.column_id === colId)
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1))

  return (
    <>
      <div className="board-header">
        <span className="title">
          {board ? `${isArchive ? '🗄️' : board.icon || '📋'} ${board.name}` : '看板'}
        </span>
        {q && (
          <span style={{ fontSize: 13, color: '#aab2c8', fontWeight: 500 }}>
            🔍 “{q}” · 命中 {visibleTasks.length} 张卡
          </span>
        )}
        <span style={{ flex: 1 }} />
        {isArchive && isSuperAdmin && (
          <Button size="small" loading={archiveM.isPending} onClick={() => archiveM.mutate()}>
            立即归档已完成
          </Button>
        )}
      </div>

      {colsLoading || tasksLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Spin size="large" />
        </div>
      ) : !boardId ? (
        <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Empty description="暂无可见看板" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="lists">
            {sorted.map((col) => (
              <BoardColumnView
                key={col.id}
                col={col}
                tasks={colTasks(col.id)}
                me={{ id: user!.id, role: user!.role }}
                isSuperAdmin={isSuperAdmin}
                onOpenCard={openCard}
                onAddCard={(colId, title) => addCardM.mutate({ colId, title })}
                onRenameColumn={(colId, name) => renameColM.mutate({ colId, name })}
                onDeleteColumn={(colId) => deleteColM.mutate(colId)}
                onSetFinal={(colId, isFinal) => setFinalM.mutate({ colId, isFinal })}
                onSetReview={(colId, requiresReview) => setReviewM.mutate({ colId, requiresReview })}
                onRestore={isArchive && isManager ? setRestoreTask : undefined}
              />
            ))}
            {isSuperAdmin && (
              <div className="list" style={{ background: '#ffffff14' }}>
                <Button
                  type="text"
                  block
                  onClick={() => {
                    const n = prompt('新列表名称')
                    if (n?.trim()) addColM.mutate(n.trim())
                  }}
                >
                  + 添加列表
                </Button>
              </div>
            )}
          </div>
        </DndContext>
      )}

      {taskIdParam && (
        <CardDetailModal taskId={Number(taskIdParam)} columns={columns} onClose={closeCard} />
      )}

      {restoreTask && (
        <RestoreModal task={restoreTask} boards={boards} onClose={() => setRestoreTask(null)} />
      )}
    </>
  )
}
