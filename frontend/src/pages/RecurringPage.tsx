import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Table,
  Tag,
  App as AntApp,
} from 'antd'
import {
  createRecurringTask,
  deleteRecurringTask,
  getAssignableUsers,
  getRecurringTasks,
  updateRecurringTask,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import type { CreateRecurringBody, RecurringTask } from '../api/types'

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

// 每周必做管理页 (admin / super_admin) — spec §6a.
export function RecurringPage() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [form] = Form.useForm<CreateRecurringBody>()

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['recurring-tasks'],
    queryFn: getRecurringTasks,
  })
  const { data: users = [] } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: getAssignableUsers,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['recurring-tasks'] })

  const createM = useMutation({
    mutationFn: (body: CreateRecurringBody) => createRecurringTask(body),
    onSuccess: () => {
      setCreateOpen(false)
      form.resetFields()
      message.success('已创建')
      invalidate()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const toggleM = useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) =>
      updateRecurringTask(id, { is_active }),
    onSuccess: invalidate,
    onError: (e) => message.error(errMessage(e)),
  })

  const deleteM = useMutation({
    mutationFn: (id: number) => deleteRecurringTask(id),
    onSuccess: () => {
      message.success('已删除')
      invalidate()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, color: '#fff' }}>🔁 每周必做</h2>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 新建模板
        </Button>
      </div>

      <Table
        rowKey="id"
        loading={isLoading}
        pagination={false}
        dataSource={templates}
        columns={[
          { title: '标题', dataIndex: 'title' },
          {
            title: '优先级',
            dataIndex: 'priority',
            render: (p: RecurringTask['priority']) =>
              p === 'high' ? <Tag color="red">高</Tag> : p === 'low' ? <Tag>低</Tag> : <Tag>普通</Tag>,
          },
          {
            title: '星期',
            dataIndex: 'day_of_week',
            render: (d: number) => WEEKDAYS[d] ?? d,
          },
          {
            title: '指派人',
            key: 'assignees',
            render: (_: unknown, r: RecurringTask) =>
              r.assignees.map((u) => u.full_name).join('、') || '—',
          },
          {
            title: '启用',
            key: 'active',
            render: (_: unknown, r: RecurringTask) => (
              <Switch
                checked={r.is_active}
                onChange={(v) => toggleM.mutate({ id: r.id, is_active: v })}
              />
            ),
          },
          {
            title: '操作',
            key: 'ops',
            render: (_: unknown, r: RecurringTask) => (
              <a
                style={{ color: '#f87168' }}
                onClick={() => {
                  if (confirm(`删除模板「${r.title}」？`)) deleteM.mutate(r.id)
                }}
              >
                删除
              </a>
            ),
          },
        ]}
      />

      <Modal
        title="新建每周必做模板"
        open={createOpen}
        okText="创建"
        confirmLoading={createM.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createM.mutate(v)}>
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" initialValue="normal">
            <Select
              options={[
                { value: 'low', label: '低' },
                { value: 'normal', label: '普通' },
                { value: 'high', label: '高' },
              ]}
            />
          </Form.Item>
          <Form.Item name="day_of_week" label="星期几" initialValue={0}>
            <Select options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))} />
          </Form.Item>
          <Form.Item name="assignee_ids" label="指派人" rules={[{ required: true }]}>
            <Select
              mode="multiple"
              placeholder="选择指派人"
              options={users.map((u) => ({ value: u.id, label: u.full_name }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
