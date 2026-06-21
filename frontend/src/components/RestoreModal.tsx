import { useState } from 'react'
import { Modal, Select, App as AntApp } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getColumns, moveTaskToBoard } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Board, Task } from '../api/types'

// Pick a target board + column to restore an archived card back onto a board.
export function RestoreModal({
  task,
  boards,
  onClose,
}: {
  task: Task
  boards: Board[]
  onClose: () => void
}) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const targets = boards.filter((b) => !b.is_archive)
  const [boardId, setBoardId] = useState<number | undefined>(targets[0]?.id)
  const [columnId, setColumnId] = useState<number | undefined>()

  const { data: columns = [] } = useQuery({
    queryKey: ['columns', boardId],
    queryFn: () => getColumns(boardId!),
    enabled: !!boardId,
  })

  const restoreM = useMutation({
    mutationFn: () => moveTaskToBoard(task.id, boardId!, columnId!),
    onSuccess: () => {
      message.success('已放回看板')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <Modal
      open
      title={`放回看板 · ${task.title}`}
      okText="放回"
      cancelText="取消"
      okButtonProps={{ disabled: !boardId || !columnId, loading: restoreM.isPending }}
      onOk={() => restoreM.mutate()}
      onCancel={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
        <div>
          <div style={{ marginBottom: 6, color: 'var(--subtle)' }}>目标看板</div>
          <Select
            style={{ width: '100%' }}
            value={boardId}
            placeholder="选择看板"
            options={targets.map((b) => ({ value: b.id, label: b.name }))}
            onChange={(v) => {
              setBoardId(v)
              setColumnId(undefined)
            }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, color: 'var(--subtle)' }}>目标列</div>
          <Select
            style={{ width: '100%' }}
            value={columnId}
            placeholder="选择列"
            options={columns.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setColumnId}
          />
        </div>
      </div>
    </Modal>
  )
}
