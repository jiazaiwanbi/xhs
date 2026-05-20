import { useCallback, useState } from 'react'

import { ApiError } from '../api/client'
import * as likeApi from '../api/like'
import type { FeedVideoItem } from '../api/types'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

export function useLikeFollow(needLogin: () => void | Promise<void>) {
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const [likeBusy, setLikeBusy] = useState<Record<string, boolean>>({})
  const [followBusy, setFollowBusy] = useState<Record<string, boolean>>({})

  const toggleLike = useCallback(
    async (item: FeedVideoItem, onChanged?: (next: FeedVideoItem) => void) => {
      if (!auth.isLoggedIn) return needLogin()
      const key = String(item.id)
      if (likeBusy[key]) return
      setLikeBusy((s) => ({ ...s, [key]: true }))
      try {
        if (item.is_liked) await likeApi.unlike(item.id)
        else await likeApi.like(item.id)
        const next = {
          ...item,
          is_liked: !item.is_liked,
          likes_count: Math.max(0, item.likes_count + (!item.is_liked ? 1 : -1)),
        }
        onChanged?.(next)
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e))
      } finally {
        setLikeBusy((s) => ({ ...s, [key]: false }))
      }
    },
    [auth.isLoggedIn, likeBusy, needLogin, toast],
  )

  const toggleFollow = useCallback(
    async (authorId: number) => {
      if (!auth.isLoggedIn) return needLogin()
      const key = String(authorId)
      if (followBusy[key]) return
      setFollowBusy((s) => ({ ...s, [key]: true }))
      try {
        if (social.isFollowing(authorId)) {
          await social.unfollow(authorId)
          toast.info('已取关')
        } else {
          await social.follow(authorId)
          toast.success('已关注')
        }
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e))
      } finally {
        setFollowBusy((s) => ({ ...s, [key]: false }))
      }
    },
    [auth.isLoggedIn, followBusy, needLogin, social, toast],
  )

  const share = useCallback(
    async (item: FeedVideoItem) => {
      const url = `${location.origin}/video/${item.id}`
      try {
        await navigator.clipboard.writeText(url)
        toast.success('链接已复制')
      } catch {
        window.prompt('复制链接', url)
      }
    },
    [toast],
  )

  return { likeBusy, followBusy, toggleLike, toggleFollow, share }
}
