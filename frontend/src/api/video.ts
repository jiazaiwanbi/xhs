import { postForm, postJson } from './client'
import { normalizeVideo, normalizeVideoList } from './normalize'
import type { Video } from './types'

export function publishVideo(input: { title: string; description: string; content_type: 'image' | 'video'; play_url: string; cover_url: string; image_urls?: string[]; notify_followers: boolean }) {
  return postJson<Video>('/video/publish', input, { authRequired: true })
}

export type UploadResponse = { url: string; play_url?: string; cover_url?: string }

export function uploadVideo(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return postForm<UploadResponse>('/video/uploadVideo', fd, { authRequired: true })
}

export function uploadCover(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return postForm<UploadResponse>('/video/uploadCover', fd, { authRequired: true })
}

export async function listByAuthorId(authorId: number) {
  const videos = await postJson<Video[] | null>('/video/listByAuthorID', { author_id: authorId })
  return normalizeVideoList(videos)
}

export async function getDetail(id: number) {
  return normalizeVideo(await postJson<Video>('/video/getDetail', { id }))
}
