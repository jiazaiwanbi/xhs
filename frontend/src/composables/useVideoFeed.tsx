import { useCallback, useMemo, useState } from 'react'

import { ApiError } from '../api/client'
import * as feedApi from '../api/feed'
import type { FeedVideoItem } from '../api/types'
import { useAuth } from '../stores/auth'

export type TabKey = 'latest' | 'hot' | 'following'

type State = {
  items: FeedVideoItem[]
  loading: boolean
  error: string
  hasMore: boolean
}

const baseState: State = { items: [], loading: false, error: '', hasMore: false }

export function useVideoFeed() {
  const auth = useAuth()
  const [tab, setTab] = useState<TabKey>('latest')
  const [latest, setLatest] = useState<State & { nextTime: number }>({ ...baseState, nextTime: 0 })
  const [hot, setHot] = useState<State & { nextLikesCountBefore?: number; nextIdBefore?: number }>({ ...baseState })
  const [following, setFollowing] = useState<State & { nextTime: number }>({ ...baseState, nextTime: 0 })

  const loadLatest = useCallback(async (reset: boolean) => {
    let blocked = false
    setLatest((s) => {
      blocked = s.loading
      return blocked ? s : { ...s, loading: true, error: '' }
    })
    if (blocked) return
    try {
      const current = latest
      const res = await feedApi.listLatest({ limit: 10, latest_time: reset ? 0 : current.nextTime })
      setLatest((s) => ({
        ...s,
        loading: false,
        hasMore: res.has_more,
        nextTime: res.next_time,
        items: reset ? res.video_list : s.items.concat(res.video_list),
      }))
    } catch (e) {
      setLatest((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }, [latest])

  const loadHot = useCallback(async (reset: boolean) => {
    let blocked = false
    setHot((s) => {
      blocked = s.loading
      return blocked ? s : { ...s, loading: true, error: '' }
    })
    if (blocked) return
    try {
      const current = hot
      const res = await feedApi.listLikesCount({
        limit: 10,
        likes_count_before: reset ? undefined : current.nextLikesCountBefore,
        id_before: reset ? undefined : current.nextIdBefore,
      })
      setHot((s) => ({
        ...s,
        loading: false,
        hasMore: res.has_more,
        nextLikesCountBefore: res.next_likes_count_before,
        nextIdBefore: res.next_id_before,
        items: reset ? res.video_list : s.items.concat(res.video_list),
      }))
    } catch (e) {
      setHot((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }, [hot])

  const loadFollowing = useCallback(async (reset: boolean) => {
    if (!auth.isLoggedIn) {
      setFollowing((s) => ({ ...s, error: '登录后才能查看关注流' }))
      return
    }
    let blocked = false
    setFollowing((s) => {
      blocked = s.loading
      return blocked ? s : { ...s, loading: true, error: '' }
    })
    if (blocked) return
    try {
      const current = following
      const res = await feedApi.listByFollowing({ limit: 10, latest_time: reset ? 0 : current.nextTime })
      setFollowing((s) => ({
        ...s,
        loading: false,
        hasMore: res.has_more,
        nextTime: res.next_time,
        items: reset ? res.video_list : s.items.concat(res.video_list),
      }))
    } catch (e) {
      setFollowing((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }, [auth.isLoggedIn, following])

  const currentState = useMemo(() => {
    if (tab === 'hot') return hot
    if (tab === 'following') return following
    return latest
  }, [following, hot, latest, tab])

  const ensureTabLoaded = useCallback(async () => {
    if (tab === 'latest' && latest.items.length === 0) await loadLatest(true)
    if (tab === 'hot' && hot.items.length === 0) await loadHot(true)
    if (tab === 'following' && following.items.length === 0) await loadFollowing(true)
  }, [following.items.length, hot.items.length, latest.items.length, loadFollowing, loadHot, loadLatest, tab])

  const replaceItem = useCallback((next: FeedVideoItem) => {
    const update = (items: FeedVideoItem[]) => items.map((item) => (item.id === next.id ? next : item))
    setLatest((s) => ({ ...s, items: update(s.items) }))
    setHot((s) => ({ ...s, items: update(s.items) }))
    setFollowing((s) => ({ ...s, items: update(s.items) }))
  }, [])

  return { tab, setTab, latest, hot, following, currentState, loadLatest, loadHot, loadFollowing, ensureTabLoaded, replaceItem }
}
