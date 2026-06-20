import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { CardDetailModal } from '../components/CardDetailModal'
import { canDropInto } from '../lib/actions'
import type { BoardColumn, Task } from '../api/types'

export function BoardPage() {
  const { boardId: boardIdParam, taskId: taskIdParam } = useParams()
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

  const onDragEnd = (e: DragEndEvent) => {
    const task = e.active.data.current?.task as Task | undefined
    const targetCol = e.over?.data.current?.col as BoardColumn | undefined
    if (!task || !targetCol || task.column_id === targetCol.id) return
    if (!canDropInto(targetCol.kind)) {
      message.warning('不能直接拖入完成列，需经审核')
      return
    }
    moveM.mutate({ id: task.id, columnId: targetCol.id })
  }

  const openCard = (id: number) => navigate(`/board/${boardId}/card/${id}`)
  const closeCard = () => navigate(`/board/${boardId}`)

  const sorted = [...columns].sort((a, b) => a.position - b.position)

  return (
    <>
      <div className="board-header">
        <span className="title">{board ? `📋 ${board.name}` : '看板'}</span>
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
                tasks={tasks.filter((t) => t.column_id === col.id)}
                me={{ id: user!.id, role: user!.role }}
                isSuperAdmin={isSuperAdmin}
                onOpenCard={openCard}
                onAddCard={(colId, title) => addCardM.mutate({ colId, title })}
                onRenameColumn={(colId, name) => renameColM.mutate({ colId, name })}
                onDeleteColumn={(colId) => deleteColM.mutate(colId)}
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
    </>
  )
}
