import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
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
  createTag,
  createUser,
  deleteTag,
  getAdminUsers,
  getDepartments,
  getTags,
  getVisibilityMatrix,
  resolveFeishu,
  setBoardMemberVisibility,
  updateTag,
  updateUser,
} from '../api/endpoints'
import { errMessage } from '../api/client'
import type { AdminUser, CreatedUser, CreateUserBody, Role, Tag, TagColor } from '../api/types'
import { TAG_COLORS, TAG_COLOR_KEYS } from '../lib/badges'

const colorOptions = TAG_COLOR_KEYS.map((c) => ({
  value: c,
  label: (
    <span
      style={{ display: 'inline-block', width: 44, height: 12, borderRadius: 3, background: TAG_COLORS[c] }}
    />
  ),
}))

function TagsTab() {
  const qc = useQueryClient()
  const { message } = AntApp.useApp()
  const { data: tags = [] } = useQuery({ queryKey: ['tags'], queryFn: getTags })

  const [name, setName] = useState('')
  const [color, setColor] = useState<TagColor>(TAG_COLOR_KEYS[0])
  const [link, setLink] = useState('')
  const [editing, setEditing] = useState<Tag | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tags'] })

  const addM = useMutation({
    mutationFn: () => createTag({ name: name.trim(), color, link: link.trim() || null }),
    onSuccess: () => {
      setName('')
      setLink('')
      message.success('已创建标签')
      invalidate()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const editM = useMutation({
    mutationFn: (body: { id: number; name: string; color: TagColor; link: string | null }) =>
      updateTag(body.id, { name: body.name, color: body.color, link: body.link }),
    onSuccess: () => {
      setEditing(null)
      message.success('已更新标签')
      invalidate()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const delM = useMutation({
    mutationFn: (id: number) => deleteTag(id),
    onSuccess: () => {
      message.success('已删除标签')
      invalidate()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input
          placeholder="标签名"
          style={{ width: 140 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Select style={{ width: 70 }} value={color} onChange={setColor} options={colorOptions} />
        <Input
          placeholder="链接 https://…（可选）"
          style={{ width: 280 }}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <Button type="primary" disabled={!name.trim()} onClick={() => addM.mutate()}>
          新建标签
        </Button>
      </div>
      <Table
        rowKey="id"
        pagination={false}
        dataSource={tags}
        columns={[
          {
            title: '标签',
            key: 'name',
            render: (_: unknown, t: Tag) => (
              <span
                className="tag-chip"
                style={{ background: TAG_COLORS[t.color], cursor: 'default' }}
              >
                {t.name}
              </span>
            ),
          },
          {
            title: '链接',
            key: 'link',
            render: (_: unknown, t: Tag) =>
              t.link ? (
                <a href={t.link} target="_blank" rel="noreferrer">
                  {t.link}
                </a>
              ) : (
                <span style={{ color: '#8c9bab' }}>—</span>
              ),
          },
          {
            title: '操作',
            key: 'ops',
            width: 140,
            render: (_: unknown, t: Tag) => (
              <span style={{ display: 'flex', gap: 8 }}>
                <Button size="small" onClick={() => setEditing(t)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该标签？"
                  description="会从所有任务上移除该标签"
                  onConfirm={() => delM.mutate(t.id)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </span>
            ),
          },
        ]}
      />

      <Modal
        open={editing !== null}
        title="编辑标签"
        onCancel={() => setEditing(null)}
        onOk={() =>
          editing &&
          editM.mutate({
            id: editing.id,
            name: editing.name.trim(),
            color: editing.color,
            link: editing.link?.trim() || null,
          })
        }
        okButtonProps={{ disabled: !editing?.name.trim(), loading: editM.isPending }}
      >
        {editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Input
              placeholder="标签名"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Select
              value={editing.color}
              onChange={(c) => setEditing({ ...editing, color: c })}
              options={colorOptions}
            />
            <Input
              placeholder="链接 https://…（留空表示无链接）"
              value={editing.link ?? ''}
              onChange={(e) => setEditing({ ...editing, link: e.target.value })}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}

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
  // Edit modal (email/phone — the Feishu @-mention identity).
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editOpenId, setEditOpenId] = useState('')

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

  const editM = useMutation({
    mutationFn: ({
      id,
      email,
      phone,
      feishu_open_id,
    }: {
      id: number
      email: string
      phone: string
      feishu_open_id: string
    }) => updateUser(id, { email, phone, feishu_open_id }),
    onSuccess: (u) => {
      message.success(
        u.feishu_open_id
          ? '已保存，飞书 @ 已绑定'
          : '已保存（未解析到飞书 open_id，@ 将回退为文本名）',
      )
      setEditUser(null)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const resolveM = useMutation({
    mutationFn: resolveFeishu,
    onSuccess: (r) => {
      message.success(`飞书解析完成：成功 ${r.resolved} / 失败 ${r.failed}（共 ${r.total}）`)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (e) => message.error(errMessage(e)),
  })

  const openEdit = (u: AdminUser) => {
    setEditEmail(u.email ?? '')
    setEditPhone(u.phone ?? '')
    setEditOpenId(u.feishu_open_id ?? '')
    setEditUser(u)
  }

  const deptName = (id: number | null) =>
    departments.find((d) => d.id === id)?.name ?? '—'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          + 预置用户
        </Button>
        <Button
          loading={resolveM.isPending}
          onClick={() => resolveM.mutate()}
          title="用各用户的邮箱/手机解析飞书 open_id（需先给应用开通通讯录权限）"
        >
          🔗 解析飞书 @
        </Button>
      </div>
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
            title: '邀请码',
            key: 'invite_code',
            render: (_: unknown, r: AdminUser) =>
              r.invite_code ? (
                <Typography.Text copyable code>
                  {r.invite_code}
                </Typography.Text>
              ) : (
                <span style={{ color: 'var(--subtle)' }}>—</span>
              ),
          },
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
          {
            title: '飞书@',
            key: 'feishu',
            render: (_: unknown, r: AdminUser) =>
              r.feishu_open_id ? (
                <span style={{ color: '#52c41a' }} title="已绑定 open_id，可真·@">
                  ✓ 已绑定
                </span>
              ) : (
                <span style={{ color: 'var(--subtle)' }} title="未绑定，@ 回退为文本名">
                  —
                </span>
              ),
          },
          {
            title: '操作',
            key: 'edit',
            render: (_: unknown, r: AdminUser) => (
              <Button size="small" onClick={() => openEdit(r)}>
                编辑
              </Button>
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
          <Form.Item name="email" label="飞书邮箱（用于 @ 通知）">
            <Input placeholder="可选，飞书绑定的邮箱" />
          </Form.Item>
          <Form.Item name="phone" label="飞书手机号（用于 @ 通知）">
            <Input placeholder="可选，飞书绑定的手机号" />
          </Form.Item>
          <Form.Item name="feishu_open_id" label="飞书 open_id（可直接填，优先于邮箱/手机解析）">
            <Input placeholder="可选，形如 ou_xxxxxxxx" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editUser ? `编辑「${editUser.full_name}」的飞书身份` : ''}
        open={!!editUser}
        okText="保存"
        confirmLoading={editM.isPending}
        onCancel={() => setEditUser(null)}
        onOk={() =>
          editUser &&
          editM.mutate({
            id: editUser.id,
            email: editEmail,
            phone: editPhone,
            feishu_open_id: editOpenId,
          })
        }
      >
        <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
          可直接填「飞书 open_id」精确绑定（优先生效）;或填飞书绑定的邮箱/手机号,
          保存后系统自动解析 open_id。解析需应用已开通通讯录权限;都没有时 @ 回退为文本名。
        </Typography.Paragraph>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6, color: 'var(--subtle)', fontSize: 13 }}>飞书邮箱</div>
          <Input
            value={editEmail}
            onChange={(e) => setEditEmail(e.target.value)}
            placeholder="飞书绑定的邮箱"
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6, color: 'var(--subtle)', fontSize: 13 }}>飞书手机号</div>
          <Input
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            placeholder="飞书绑定的手机号"
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, color: 'var(--subtle)', fontSize: 13 }}>
            飞书 open_id（直接填，优先于上面的解析）
          </div>
          <Input
            value={editOpenId}
            onChange={(e) => setEditOpenId(e.target.value)}
            placeholder="形如 ou_xxxxxxxx，留空则用邮箱/手机解析"
          />
        </div>
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
          { key: 'tags', label: '标签', children: <TagsTab /> },
          { key: 'visibility', label: '看板可见性', children: <VisibilityTab /> },
        ]}
      />
    </div>
  )
}
