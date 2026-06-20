import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Form, Input, Typography, App as AntApp } from 'antd'
import { register } from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { RegisterBody } from '../api/types'

export function RegisterPage() {
  const { setToken } = useAuth()
  const navigate = useNavigate()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: RegisterBody) => {
    setLoading(true)
    try {
      const res = await register(values)
      setToken(res.access_token)
      navigate('/board')
    } catch (err) {
      message.error(errMessage(err, '注册失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          注册
        </Typography.Title>
        <Typography.Text type="secondary">用邀请码激活账号</Typography.Text>
        <Form layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="invite_code" label="邀请码" rules={[{ required: true }]}>
            <Input autoFocus placeholder="邀请码" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input placeholder="自选用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password placeholder="自选密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            注册并登录
          </Button>
        </Form>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login">已有账号？去登录</Link>
        </div>
      </div>
    </div>
  )
}
