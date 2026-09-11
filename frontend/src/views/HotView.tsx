import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import * as feedApi from '../api/feed'
import * as likeApi from '../api/like'
import type { FeedVideoItem } from '../api/types'
import AppShell from '../components/AppShell'
import FeedVideoCard from '../components/FeedVideoCard'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/toast'

export default function HotView() {
  const auth = useAuth()
  const toast = useToast()
  const [state, setState] = useState({ loading: false, error: '', items: [] as FeedVideoItem[], hasMore: false, limit: 10, asOf: 0, nextOffset: 0 })
  const [likeBusy, setLikeBusy] = useState<Record<string, boolean>>({})

  async function loadHot(reset: boolean) {
    if (state.loading) return
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await feedApi.listByPopularity({ limit: state.limit, as_of: reset ? 0 : state.asOf, offset: reset ? 0 : state.nextOffset })
      setState((s) => ({
        ...s,
        loading: false,
        hasMore: res.has_more,
        asOf: res.as_of,
        nextOffset: res.next_offset,
        items: reset ? res.video_list : s.items.concat(res.video_list),
      }))
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }

  async function toggleLike(item: FeedVideoItem) {
    if (!auth.isLoggedIn) return toast.error('请先登录')
    const key = String(item.id)
    if (likeBusy[key]) return
    setLikeBusy((s) => ({ ...s, [key]: true }))
    try {
      if (item.is_liked) await likeApi.unlike(item.id)
      else await likeApi.like(item.id)
      const next = { ...item, is_liked: !item.is_liked, likes_count: Math.max(0, item.likes_count + (!item.is_liked ? 1 : -1)) }
      setState((s) => ({ ...s, items: s.items.map((v) => (v.id === next.id ? next : v)) }))
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setLikeBusy((s) => ({ ...s, [key]: false }))
    }
  }

  useEffect(() => {
    void loadHot(true)
  }, [])

  return (
    <AppShell full>
      <main className="page hot-page">
        <header className="section-heading"><div><h1>热门内容</h1><p>发现社区里正在流行的精彩内容</p></div><button className="quiet-btn" type="button" disabled={state.loading} onClick={() => void loadHot(true)}>刷新</button></header>
        {state.error ? <div className="state-panel error">{state.error}<button type="button" onClick={() => void loadHot(true)}>重新加载</button></div> : null}
        {state.loading && state.items.length === 0 ? <div className="state-panel">正在加载热门内容…</div> : null}
        {!state.loading && !state.error && state.items.length === 0 ? <div className="state-panel">暂时没有热门内容</div> : null}
        {state.items.length ? (
          <div className="hot-grid">
            {state.items.map((item, idx) => (
              <div key={`hot-${item.id}`} className="hot-card-wrap">
                <div className={`hot-rank ${idx < 3 ? 'top' : ''}`}>{idx + 1}</div>
                <FeedVideoCard item={item} canLike={auth.isLoggedIn} busy={!!likeBusy[String(item.id)]} onToggleLike={(v) => void toggleLike(v)} />
              </div>
            ))}
          </div>
        ) : null}
        {state.items.length && state.hasMore ? <div className="load-more-row"><button className="quiet-btn" type="button" disabled={state.loading} onClick={() => void loadHot(false)}>{state.loading ? '加载中…' : '加载更多'}</button></div> : null}
      </main>
    </AppShell>
  )
}
