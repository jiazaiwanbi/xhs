import type { Account, Comment, FeedAuthor, FeedVideoItem, Video } from './types'

export function listOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : []
}

export function normalizeAccount(value: Account | null | undefined): Account {
  return {
    id: Number(value?.id ?? 0),
    username: value?.username || '匿名用户',
  }
}

function normalizeAuthor(value: FeedAuthor | null | undefined): FeedAuthor {
  return {
    id: Number(value?.id ?? 0),
    username: value?.username || '匿名用户',
  }
}

export function normalizeFeedVideoItem(value: FeedVideoItem): FeedVideoItem {
  const imageUrls = Array.isArray(value.image_urls) ? value.image_urls.filter(Boolean) : []
  const contentType = value.content_type === 'image' || imageUrls.length > 0 || (!!value.play_url && value.play_url === value.cover_url) ? 'image' : 'video'
  return {
    ...value,
    author: normalizeAuthor(value.author),
    title: value.title || '未命名笔记',
    description: value.description || '',
    play_url: value.play_url || '',
    cover_url: value.cover_url || '',
    content_type: contentType,
    image_urls: imageUrls,
    create_time: Number(value.create_time ?? 0),
    likes_count: Number(value.likes_count ?? 0),
    is_liked: Boolean(value.is_liked),
  }
}

export function normalizeFeedVideoList(value: FeedVideoItem[] | null | undefined): FeedVideoItem[] {
  return listOrEmpty(value).map(normalizeFeedVideoItem)
}

export function normalizeVideo(video: Video): Video {
  const imageUrls = Array.isArray(video.image_urls) ? video.image_urls.filter(Boolean) : []
  const contentType = video.content_type === 'image' || imageUrls.length > 0 || (!!video.play_url && video.play_url === video.cover_url) ? 'image' : 'video'
  return {
    ...video,
    username: video.username || '匿名用户',
    title: video.title || '未命名笔记',
    description: video.description || '',
    play_url: video.play_url || '',
    cover_url: video.cover_url || imageUrls[0] || '',
    content_type: contentType,
    image_urls: imageUrls,
    likes_count: Number(video.likes_count ?? 0),
  }
}

export function normalizeVideoList(value: Video[] | null | undefined): Video[] {
  return listOrEmpty(value).map(normalizeVideo)
}

export function normalizeCommentList(value: Comment[] | null | undefined): Comment[] {
  return listOrEmpty(value).map((comment) => ({
    ...comment,
    username: comment.username || '匿名用户',
    content: comment.content || '',
  }))
}
