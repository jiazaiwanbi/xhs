import { postJson } from './client'
import type { ListNotificationsResponse, MessageResponse } from './types'

export function listNotifications() {
  return postJson<ListNotificationsResponse>('/notification/list', {}, { authRequired: true })
}

export function markNotificationRead(id?: number) {
  return postJson<MessageResponse>('/notification/markRead', id ? { id } : {}, { authRequired: true })
}
