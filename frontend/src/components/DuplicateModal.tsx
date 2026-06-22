import { useState } from 'react'
import { Modal, Select, Typography, App as AntApp } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { duplicateTask, getAssignableUsers } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Task } from '../api/types'

// Copy a card's requirement into a new card and assign it to someone. The 产出
// side (deliverables/comments) is not copied.
export function DuplicateModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { message } = AntApp.useApp()
  const qc = useQueryClient()
  const [assigneeId, setAssigneeId] = useState<number | undefined>()

  const { data: users = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: getAssignableUsers,
  })

  const dupM = useMutation({
    mutationFn: () => duplicateTask(task.id, assigneeId!),
    onSuccess: () => {
      message.success('已复制并指派')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <Modal
      open
      title={`复制卡片 · ${task.title}`}
      okText="复制并指派"
      cancelText="取消"
      okButtonProps={{ disabled: !assigneeId, loading: dupM.isPending }}
      onOk={() => dupM.mutate()}
      onCancel={onClose}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        将复制需求内容（描述、优先级、截止时间、需求附件、清单、标签）到一张新卡片并指派给所选人员。产出、留言不会被复制。
      </Typography.Paragraph>
      <div style={{ marginBottom: 6, color: 'var(--subtle)' }}>指派给</div>
      <Select
        style={{ width: '100%' }}
        value={assigneeId}
        placeholder="选择人员"
        showSearch
        optionFilterProp="label"
        options={users.map((u) => ({ value: u.id, label: u.full_name }))}
        onChange={setAssigneeId}
      />
    </Modal>
  )
}
