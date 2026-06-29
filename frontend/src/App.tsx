import { Navigate, Route, Routes } from 'react-router-dom'
import { Spin } from 'antd'
import { useAuth } from './auth/AuthContext'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { BoardPage } from './pages/BoardPage'
import { PoolPage } from './pages/PoolPage'
import { ApprovalPage } from './pages/ApprovalPage'
import { AdminPage } from './pages/AdminPage'
import { RecurringPage } from './pages/RecurringPage'
import { StatsPage } from './pages/StatsPage'
import { TrashPage } from './pages/TrashPage'

function FullScreenSpin() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <Spin size="large" />
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenSpin />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireSuperAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenSpin />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'super_admin') return <Navigate to="/board" replace />
  return <>{children}</>
}

function RequireManager({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenSpin />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    return <Navigate to="/board" replace />
  }
  return <>{children}</>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/board" element={<BoardPage />} />
        <Route path="/board/card/:taskId" element={<BoardPage />} />
        <Route path="/board/:boardId" element={<BoardPage />} />
        <Route path="/board/:boardId/card/:taskId" element={<BoardPage />} />
        <Route path="/pool" element={<PoolPage />} />
        <Route path="/approvals" element={<ApprovalPage />} />
        <Route
          path="/recurring"
          element={
            <RequireManager>
              <RecurringPage />
            </RequireManager>
          }
        />
        <Route
          path="/stats"
          element={
            <RequireManager>
              <StatsPage />
            </RequireManager>
          }
        />
        <Route
          path="/trash"
          element={
            <RequireManager>
              <TrashPage />
            </RequireManager>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireSuperAdmin>
              <AdminPage />
            </RequireSuperAdmin>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/board" replace />} />
    </Routes>
  )
}
