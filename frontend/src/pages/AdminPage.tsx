import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Select,
  Spin,
  Switch,
  Table,
  Tabs,
  Typography,
  App as AntApp,
} from 'antd'
import {
  createDepartment,
  createUser,
  getAdminUsers,
  getDepartments,
  getVisibilityMatrix,
  setBoardMemberVisibility,
  updateUser,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import type { AdminUser, CreatedUser, CreateUserBody, Role } from '../api/types'

function DepartmentsTab() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
  })
  const [name, setName] = useState('')

  const addM = useMutation({
    mutationFn: () => createDepartment(name.trim()),
    onSuccess: () => {
      setName('')
      message.success('已创建部门')
      qc.invalidateQueries({ queryKey: ['departments'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 400 }}>
        <Input placeholder="部门名称" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="primary" disabled={!name.trim()} onClick={() => addM.mutate()}>
          新建部门
        </Button>
      </div>
      <Table
        rowKey="id"
        pagination={false}
        dataSource={departments}
        columns={[
          { title: 'ID', dataIndex: 'id' },
          { title: '名称', dataIndex: 'name' },
        ]}
      />
    </div>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { data: users = [] } = useQuery({ queryKey: ['admin-users'], queryFn: getAdminUsers })
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: getDepartments,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const [form] = Form.useForm<CreateUserBody>()

  const createM = useMutation({
    mutationFn: (body: CreateUserBody) => createUser(body),
    onSuccess: (u) => {
      setCreated(u)
      setCreateOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const toggleM = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { role?: Role; is_active?: boolean } }) =>
      updateUser(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
    onError: (e) => message.error(errMessage(e)),
  })

  const deptName = (id: number | null) =>
    departments.find((d) => d.id === id)?.name ?? '—'

  return (
    <div>
      <Button type="primary" style={{ marginBottom: 16 }} onClick={() => setCreateOpen(true)}>
        + 预置用户
      </Button>
      <Table
        rowKey="id"
        pagination={false}
        dataSource={users}
        columns={[
          { title: '真名', dataIndex: 'full_name' },
          { title: '用户名', dataIndex: 'username', render: (u: string | null) => u ?? '—' },
          {
            title: '部门',
            key: 'dept',
            render: (_: unknown, r: AdminUser) => deptName(r.department_id),
          },
          {
            title: '角色',
            key: 'role',
            render: (_: unknown, r: AdminUser) => (
              <Select
                size="small"
                value={r.role}
                style={{ width: 120 }}
                disabled={r.role === 'super_admin'}
                options={[
                  { value: 'member', label: 'member' },
                  { value: 'admin', label: 'admin' },
                ]}
                onChange={(role) => toggleM.mutate({ id: r.id, body: { role } })}
              />
            ),
          },
          { title: '状态', dataIndex: 'account_status' },
          {
            title: '启用',
            key: 'active',
            render: (_: unknown, r: AdminUser) => (
              <Switch
                defaultChecked
                disabled={r.role === 'super_admin'}
                onChange={(v) => toggleM.mutate({ id: r.id, body: { is_active: v } })}
              />
            ),
          },
        ]}
      />

      <Modal
        title="预置用户"
        open={createOpen}
        okText="生成邀请码"
        confirmLoading={createM.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(v) => createM.mutate(v)}>
          <Form.Item name="full_name" label="真名" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="department_id" label="部门" rules={[{ required: true }]}>
            <Select options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="member" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'member', label: 'member' },
                { value: 'admin', label: 'admin' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="用户已创建 — 邀请码"
        open={!!created}
        footer={[
          <Button
            key="copy"
            type="primary"
            onClick={() => {
              if (created) navigator.clipboard?.writeText(created.invite_code)
              message.success('已复制')
            }}
          >
            复制邀请码
          </Button>,
          <Button key="close" onClick={() => setCreated(null)}>
            关闭
          </Button>,
        ]}
        onCancel={() => setCreated(null)}
      >
        <Typography.Paragraph>
          把以下一次性邀请码发给 <b>{created?.full_name}</b>，用于注册激活：
        </Typography.Paragraph>
        <Typography.Title level={3} copyable style={{ textAlign: 'center' }}>
          {created?.invite_code}
        </Typography.Title>
      </Modal>
    </div>
  )
}

function VisibilityTab() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { data, isLoading } = useQuery({
    queryKey: ['visibility-matrix'],
    queryFn: getVisibilityMatrix,
  })

  const setM = useMutation({
    mutationFn: ({ boardId, userIds }: { boardId: number; userIds: number[] }) =>
      setBoardMemberVisibility(boardId, userIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['visibility-matrix'] }),
    onError: (e) => message.error(errMessage(e)),
  })

  if (isLoading || !data) return <Spin />
  const { boards, users, visibility } = data
  const allUserIds = users.map((u) => u.id)

  // unrestricted (no rows) => visible to all => every box checked
  const isChecked = (boardId: number, userId: number) =>
    visibility[boardId] === undefined || visibility[boardId].includes(userId)

  const toggle = (boardId: number, userId: number, checked: boolean) => {
    const current =
      visibility[boardId] === undefined ? new Set(allUserIds) : new Set(visibility[boardId])
    if (checked) current.add(userId)
    else current.delete(userId)
    // all checked => store empty (unrestricted); else explicit allow-list
    const userIds = current.size === allUserIds.length ? [] : [...current]
    setM.mutate({ boardId, userIds })
  }

  return (
    <div>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 14 }}>
        勾选 = 该人员可见此看板；取消勾选则不可见。某看板全部勾选 = 对所有人可见（默认）。super_admin 始终可见全部，不在表内。
      </Typography.Paragraph>
      <Table
        rowKey="id"
        pagination={false}
        scroll={{ x: true }}
        dataSource={users}
        columns={[
          {
            title: '人员',
            key: 'user',
            fixed: 'left',
            render: (_: unknown, u: (typeof users)[number]) => (
              <span>
                {u.full_name} <span style={{ color: 'var(--subtle)' }}>· {u.role}</span>
              </span>
            ),
          },
          ...boards.map((b) => ({
            title: `📋 ${b.name}`,
            key: `board-${b.id}`,
            align: 'center' as const,
            render: (_: unknown, u: (typeof users)[number]) => (
              <Checkbox
                checked={isChecked(b.id, u.id)}
                disabled={setM.isPending}
                onChange={(e) => toggle(b.id, u.id, e.target.checked)}
              />
            ),
          })),
        ]}
      />
    </div>
  )
}

export function AdminPage() {
  return (
    <div className="page-pad">
      <h2 style={{ marginTop: 0, color: '#fff' }}>⚙ 管理</h2>
      <Tabs
        items={[
          { key: 'users', label: '用户', children: <UsersTab /> },
          { key: 'departments', label: '部门', children: <DepartmentsTab /> },
          { key: 'visibility', label: '看板可见性', children: <VisibilityTab /> },
        ]}
      />
    </div>
  )
}
