import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Form, Input, Typography, App as AntApp } from 'antd'
import { login } from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { LoginBody } from '../api/types'

export function LoginPage() {
  const { setToken } = useAuth()
  const navigate = useNavigate()
  const { message } = AntApp.useApp()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: LoginBody) => {
    setLoading(true)
    try {
      const res = await login(values)
      setToken(res.access_token)
      navigate('/board')
    } catch (err) {
      message.error(errMessage(err, '用户名或密码错误'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          PP API任务系统
        </Typography.Title>
        <Typography.Text type="secondary">登录以继续</Typography.Text>
        <Form layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input autoFocus placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading}>
            登录
          </Button>
        </Form>
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/register">有邀请码？去注册</Link>
        </div>
      </div>
    </div>
  )
}
