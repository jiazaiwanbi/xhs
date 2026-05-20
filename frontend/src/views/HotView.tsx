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
    <AppShell>
      <div className="card">
        <div className="row spread baseline">
          <div>
            <p className="title">爆款笔记热榜</p>
            <p className="subtle">按互动热度排序，适合演示热门图文内容流</p>
          </div>
          <div className="row">
            <label className="subtle">limit</label>
            <input value={state.limit} type="number" min="1" max="50" style={{ width: 90 }} disabled={state.loading} onChange={(e) => setState((s) => ({ ...s, limit: Number(e.target.value) }))} />
            <button className="primary" type="button" disabled={state.loading} onClick={() => void loadHot(true)}>
              刷新
            </button>
            <button type="button" disabled={state.loading || !state.hasMore} onClick={() => void loadHot(false)}>
              加载更多
            </button>
          </div>
        </div>
        {state.error ? <div className="pill bad spaced">错误：{state.error}</div> : null}
        {state.loading && state.items.length === 0 ? <div className="subtle spaced">加载中...</div> : null}
        {!state.loading && state.items.length === 0 ? <div className="subtle spaced">暂无内容</div> : null}
        {state.items.length ? (
          <div className="rank-list spaced">
            {state.items.map((item, idx) => (
              <div key={`hot-${item.id}`} className="rank-row">
                <div className={`rank-num ${idx < 3 ? 'top' : ''}`}>{idx + 1}</div>
                <FeedVideoCard item={item} canLike={auth.isLoggedIn} busy={!!likeBusy[String(item.id)]} onToggleLike={(v) => void toggleLike(v)} />
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
