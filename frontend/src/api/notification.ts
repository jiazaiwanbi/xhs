import { postJson } from './client'
import type { ListNotificationsResponse, MessageResponse, UnreadCountResponse } from './types'

export function listNotifications() {
  return postJson<ListNotificationsResponse>('/notification/list', {}, { authRequired: true })
}

export function markNotificationRead(id?: number) {
  return postJson<MessageResponse>('/notification/markRead', id ? { id } : {}, { authRequired: true })
}

export function unreadNotificationCount() {
  return postJson<UnreadCountResponse>('/notification/unreadCount', {}, { authRequired: true })
}
