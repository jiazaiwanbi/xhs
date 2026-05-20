import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'info'

export type Toast = {
  id: number
  type: ToastType
  message: string
}

type ToastContextValue = {
  toasts: Toast[]
  push: (type: ToastType, message: string, ttlMs?: number) => void
  remove: (id: number) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

let nextId = 1

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((items) => items.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (type: ToastType, message: string, ttlMs = 2600) => {
      const id = nextId++
      setToasts((items) => [...items, { id, type, message }])
      window.setTimeout(() => remove(id), ttlMs)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      remove,
      success: (message) => push('success', message),
      error: (message) => push('error', message, 3600),
      info: (message) => push('info', message),
    }),
    [push, remove, toasts],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export function useToast() {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used within ToastProvider')
  return value
}
