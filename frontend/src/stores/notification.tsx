import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { ApiError } from '../api/client'
import * as notificationApi from '../api/notification'
import type { NotificationItem } from '../api/types'
import { useAuth } from './auth'
import { useToast } from './toast'

type NotificationCategory = 'likes' | 'replies'

type NotificationContextValue = {
  notifications: NotificationItem[]
  likes: NotificationItem[]
  replies: NotificationItem[]
  loading: boolean
  error: string
  unreadCount: number
  refresh: () => Promise<void>
  clear: () => void
  markCategoryRead: (category: NotificationCategory) => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

function sortNotifications(items: NotificationItem[]) {
  return [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

function isReplyType(type: string) {
  return type === 'comment' || type === 'mention'
}

function isSupportedType(type: string) {
  return type === 'like' || isReplyType(type)
}

function toMessage(type: string) {
  if (type === 'like') return '收到一个新赞'
  if (type === 'mention') return '有人在评论里提到了你'
  return '收到一条新回复'
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const toast = useToast()
  const streamRef = useRef<EventSource | null>(null)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const clear = useCallback(() => {
    setNotifications([])
    setLoading(false)
    setError('')
  }, [])

  const refresh = useCallback(async () => {
    if (!auth.isLoggedIn) {
      clear()
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await notificationApi.listNotifications()
      setNotifications(sortNotifications((res.notifications ?? []).filter((item) => isSupportedType(item.type))))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [auth.isLoggedIn, clear])

  const markCategoryRead = useCallback(
    async (category: NotificationCategory) => {
      const targets = notifications.filter((item) => {
        if (item.is_read) return false
        return category === 'likes' ? item.type === 'like' : isReplyType(item.type)
      })
      if (targets.length === 0) return
      await Promise.all(targets.map((item) => notificationApi.markNotificationRead(item.id)))
      setNotifications((items) =>
        items.map((item) =>
          targets.some((target) => target.id === item.id)
            ? { ...item, is_read: true }
            : item,
        ),
      )
    },
    [notifications],
  )

  useEffect(() => {
    if (!auth.isLoggedIn || !auth.token) {
      streamRef.current?.close()
      streamRef.current = null
      clear()
      return
    }

    void refresh()

    const stream = new EventSource(`${API_BASE}/notification/stream?token=${encodeURIComponent(auth.token)}`)
    streamRef.current = stream
    stream.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as NotificationItem
        if (!isSupportedType(next.type)) return
        setNotifications((items) => {
          const deduped = items.filter((item) => item.id !== next.id)
          return sortNotifications([next, ...deduped]).slice(0, 50)
        })
        toast.info(toMessage(next.type))
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
    stream.onerror = () => {
      setError((current) => current || '动态连接已断开，稍后会自动重连')
    }

    return () => {
      stream.close()
      if (streamRef.current === stream) streamRef.current = null
    }
  }, [auth.isLoggedIn, auth.token, clear, refresh, toast])

  const value = useMemo<NotificationContextValue>(() => {
    const likes = notifications.filter((item) => item.type === 'like')
    const replies = notifications.filter((item) => isReplyType(item.type))
    const unreadCount = notifications.reduce((total, item) => total + (item.is_read ? 0 : 1), 0)
    return {
      notifications,
      likes,
      replies,
      loading,
      error,
      unreadCount,
      refresh,
      clear,
      markCategoryRead,
    }
  }, [clear, error, loading, markCategoryRead, notifications, refresh])

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotification() {
  const value = useContext(NotificationContext)
  if (!value) throw new Error('useNotification must be used within NotificationProvider')
  return value
}
