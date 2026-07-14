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
import { Button, Empty, Segmented, Spin, App as AntApp } from 'antd'
import {
  archiveNow,
  createColumn,
  createTask,
  deleteColumn,
  getAssignableUsers,
  getDepartments,
  getBoards,
  getColumns,
  getTasks,
  moveTask,
  restoreTaskToOrigin,
  updateColumn,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { BoardColumnView } from '../components/BoardColumn'
import { DuplicateModal } from '../components/DuplicateModal'
import { PRIORITY_RANK } from '../lib/badges'
import { CardDetailModal } from '../components/CardDetailModal'
import { CardFront } from '../components/TaskCard'
import { groupByWeek } from '../lib/weeks'
import { canDropInto } from '../lib/actions'
import type { BoardColumn, CreateTaskBody, Task } from '../api/types'

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
      // Preserve a deep-linked card (/board/card/:taskId) when filling in the
      // default board, otherwise the redirect would drop the task and just show
      // the board.
      const dest = taskIdParam
        ? `/board/${boards[0].id}/card/${taskIdParam}`
        : `/board/${boards[0].id}`
      navigate(dest, { replace: true })
    }
  }, [boardIdParam, taskIdParam, boards, navigate])

  const board = boards.find((b) => b.id === boardId)
  const isSuperAdmin = user?.role === 'super_admin'
  const isManager = user?.role === 'admin' || isSuperAdmin
  const isArchive = !!board?.is_archive
  const [copyTask, setCopyTask] = useState<Task | null>(null)
  // admin/super: toggle between everyone's cards and only my own on this board.
  const [mineOnly, setMineOnly] = useState(false)
  // archive board only: group cards by source board (default) or by archive week.
  const [archiveView, setArchiveView] = useState<'source' | 'week'>(() =>
    localStorage.getItem('archiveView') === 'week' ? 'week' : 'source',
  )

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

  // Candidates for the "指派给谁" picker on the add-card form (managers only).
  const { data: assignees = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: getAssignableUsers,
    enabled: isManager,
  })

  // super_admin picks which department's pool a card joins (they have none).
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
    enabled: isSuperAdmin,
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
    mutationFn: ({
      title,
      assigneeId,
      departmentId,
    }: {
      title: string
      assigneeId?: number | null
      departmentId?: number | null
    }) => {
      // member: self-submit -> pending_approval (no assignee choice).
      // admin/super: chosen assignee -> on_board; left empty -> open pool (keeps board info).
      if (user?.role === 'member') return createTask({ title, board_id: boardId! })
      const body: CreateTaskBody = { title, board_id: boardId! }
      if (assigneeId != null) body.assignee_id = assigneeId
      // super_admin has no department: they pick which department's pool to seed.
      if (departmentId != null) body.department_id = departmentId
      return createTask(body)
    },
    onSuccess: (task) => {
      message.success(
        task.lifecycle === 'open'
          ? '已创建到需求池'
          : task.lifecycle === 'pending_approval'
            ? '已提交，等待管理员审批'
            : '已添加卡片',
      )
      qc.invalidateQueries({ queryKey: ['tasks', boardId, 'on_board'] })
      qc.invalidateQueries({ queryKey: ['tasks', 'pending_approval'] })
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

  // 放回原看板：一键还原到原看板的「最终验收」列（归档来源）。
  const restoreOriginM = useMutation({
    mutationFn: (id: number) => restoreTaskToOrigin(id),
    onSuccess: () => {
      message.success('已放回原看板的最终验收列')
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
  // "我的" scope (admin/super) keeps only cards assigned to the current user.
  const inScope = (t: Task) => !mineOnly || t.assignee?.id === user?.id
  const visibleTasks = tasks.filter((t) => inScope(t) && matchesSearch(t))

  // Cards within a column always sort by priority (P0 → P1 → P2); same priority
  // keeps its original order (stable). Memoized per column at render time below.
  const colTasks = (colId: number) =>
    visibleTasks
      .filter((t) => t.column_id === colId)
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1))

  const weekView = isArchive && archiveView === 'week'
  const weekGroups = weekView ? groupByWeek(visibleTasks) : []

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
        {isArchive && (
          <Segmented
            size="small"
            value={archiveView}
            onChange={(v) => {
              const val = v as 'source' | 'week'
              setArchiveView(val)
              localStorage.setItem('archiveView', val)
            }}
            options={[
              { label: '按来源看板', value: 'source' },
              { label: '按周', value: 'week' },
            ]}
          />
        )}
        {isManager && (
          <Segmented
            size="small"
            value={mineOnly ? 'mine' : 'all'}
            onChange={(v) => setMineOnly(v === 'mine')}
            options={[
              { label: '全部任务', value: 'all' },
              { label: '只看我的', value: 'mine' },
            ]}
          />
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
      ) : weekView ? (
        weekGroups.length === 0 ? (
          <div style={{ display: 'grid', placeItems: 'center', flex: 1 }}>
            <Empty description="暂无归档卡片" />
          </div>
        ) : (
          <div className="lists">
            {weekGroups.map((g) => (
              <div key={g.key} className="list">
                <div className="list-head">
                  <span>{g.label}</span>
                  {g.isCurrent && <span className="col-final-tag">本周</span>}
                  <span className="count">{g.tasks.length}</span>
                </div>
                {g.tasks.map((t) => (
                  <div
                    key={t.id}
                    className="card card-done"
                    data-spine={t.priority === 'high' ? 'high' : undefined}
                    onClick={() => openCard(t.id)}
                  >
                    <CardFront task={t} columnKind="done" isFinal />
                    {isManager && (
                      <button
                        type="button"
                        className="card-restore"
                        onClick={(e) => {
                          e.stopPropagation()
                          restoreOriginM.mutate(t.id)
                        }}
                      >
                        ↩ 放回原看板
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
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
                assignees={assignees}
                departments={departments}
                onOpenCard={openCard}
                onAddCard={(_colId, title, assigneeId, departmentId) =>
                  addCardM.mutate({ title, assigneeId, departmentId })
                }
                onRenameColumn={(colId, name) => renameColM.mutate({ colId, name })}
                onDeleteColumn={(colId) => deleteColM.mutate(colId)}
                onSetFinal={(colId, isFinal) => setFinalM.mutate({ colId, isFinal })}
                onSetReview={(colId, requiresReview) => setReviewM.mutate({ colId, requiresReview })}
                onRestore={
                  isArchive && isManager ? (t) => restoreOriginM.mutate(t.id) : undefined
                }
                onCopy={isManager && !isArchive ? setCopyTask : undefined}
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

      {copyTask && <DuplicateModal task={copyTask} onClose={() => setCopyTask(null)} />}
    </>
  )
}
