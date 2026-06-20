import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { MeUser } from '../api/types'
import { getMe } from '../api/endpoints'
import { tokenStore } from '../api/client'

interface AuthState {
  user: MeUser | null
  loading: boolean
  setToken: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadMe = () => {
    if (!tokenStore.get()) {
      setUser(null)
      setLoading(false)
      return
    }
    setLoading(true)
    getMe()
      .then(setUser)
      .catch(() => {
        tokenStore.clear()
        setUser(null)
      })
      .finally(() => setLoading(false))
  }

  useEffect(loadMe, [])

  const setToken = (token: string) => {
    tokenStore.set(token)
    loadMe()
  }

  const logout = () => {
    tokenStore.clear()
    setUser(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ user, loading, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
