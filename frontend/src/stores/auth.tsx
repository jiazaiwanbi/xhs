import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'

import { decodeJwtPayload, type JwtPayload } from '../utils/jwt'

const ACCESS_KEY = 'access_token'
const REFRESH_KEY = 'refresh_token'

type AuthSnapshot = {
  token: string | null
  refreshToken: string | null
}

type AuthContextValue = AuthSnapshot & {
  isLoggedIn: boolean
  claims: JwtPayload | null
  setToken: (token: string) => void
  setTokens: (access: string, refresh: string) => void
  clearTokens: () => void
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  localStorage.setItem(key, value)
}

function removeStored(key: string) {
  localStorage.removeItem(key)
}

let snapshot: AuthSnapshot = {
  token: readStored(ACCESS_KEY),
  refreshToken: readStored(REFRESH_KEY),
}

const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export const authStore = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  setToken(newToken: string) {
    snapshot = { ...snapshot, token: newToken }
    writeStored(ACCESS_KEY, newToken)
    emit()
  },
  setTokens(access: string, refresh: string) {
    snapshot = { token: access, refreshToken: refresh }
    writeStored(ACCESS_KEY, access)
    writeStored(REFRESH_KEY, refresh)
    emit()
  },
  clearTokens() {
    snapshot = { token: null, refreshToken: null }
    removeStored(ACCESS_KEY)
    removeStored(REFRESH_KEY)
    emit()
  },
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot, authStore.getSnapshot)
  const claims = useMemo(() => (state.token ? decodeJwtPayload(state.token) : null), [state.token])
  const setToken = useCallback((token: string) => authStore.setToken(token), [])
  const setTokens = useCallback((access: string, refresh: string) => authStore.setTokens(access, refresh), [])
  const clearTokens = useCallback(() => authStore.clearTokens(), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isLoggedIn: !!state.token,
      claims,
      setToken,
      setTokens,
      clearTokens,
    }),
    [claims, clearTokens, setToken, setTokens, state],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider')
  return value
}
