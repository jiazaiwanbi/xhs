import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import AppShell from '../components/AppShell'
import FeedVideoCard from '../components/FeedVideoCard'
import { useLikeFollow } from '../composables/useLikeFollow'
import { useVideoFeed } from '../composables/useVideoFeed'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/toast'

export default function HomeView() {
  const auth = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { tab, setTab, following, currentState, loadFollowing, loadLatest, loadHot, ensureTabLoaded, replaceItem } = useVideoFeed()

  async function needLogin() {
    toast.error('请先登录')
    await navigate('/account')
  }

  const { likeBusy, toggleLike } = useLikeFollow(needLogin)
  const q = (params.get('q') ?? '').trim().toLowerCase()
  const filteredItems = useMemo(() => {
    if (!q) return currentState.items
    return currentState.items.filter((v) => [v.title, v.description || '', v.author.username].some((part) => part.toLowerCase().includes(q)))
  }, [currentState.items, q])

  useEffect(() => {
    void ensureTabLoaded()
  }, [tab])

  useEffect(() => {
    if (tab === 'following' && auth.isLoggedIn && following.items.length === 0) void loadFollowing(true)
  }, [auth.isLoggedIn, following.items.length, loadFollowing, tab])

  const tabCopy =
    tab === 'following'
      ? '看看你关注的人最近都在发什么图文内容。'
      : tab === 'hot'
        ? '按热度排序，适合展示“爆款图文内容”的效果。'
        : '最新流按发布时间倒序展示图文笔记，适合快速查看社区刚刚更新的内容。'

  async function refreshCurrentTab() {
    if (tab === 'latest') await loadLatest(true)
    else if (tab === 'hot') await loadHot(true)
    else await loadFollowing(true)
  }

  async function loadMoreCurrentTab() {
    if (tab === 'latest') await loadLatest(false)
    else if (tab === 'hot') await loadHot(false)
    else await loadFollowing(false)
  }

  return (
    <AppShell
      full
      onContentScroll={(event) => {
        const el = event.currentTarget
        if (!currentState.loading && currentState.hasMore && el.scrollTop + el.clientHeight >= el.scrollHeight - 240) void loadMoreCurrentTab()
      }}
    >
      <div className="page">
        <section className="hero">
          <div>
            <div className="hero-kicker">图文社区 Demo</div>
            <h1 className="hero-title">沉浸式浏览最新图文笔记，快速体验小红书风格社区首页</h1>
            <p className="hero-copy">{tabCopy}</p>
          </div>
          <div className="hero-tabs">
            <button className={`tab ${tab === 'latest' ? 'on' : ''}`} type="button" onClick={() => setTab('latest')}>
              最新
            </button>
            <button className={`tab ${tab === 'following' ? 'on' : ''}`} type="button" onClick={() => setTab('following')}>
              关注
            </button>
            <button className={`tab ${tab === 'hot' ? 'on' : ''}`} type="button" onClick={() => setTab('hot')}>
              热榜
            </button>
          </div>
        </section>

        <section className="stream-head">
          <div className="subtle">
            当前共 {filteredItems.length} 条{q ? '匹配到的' : ''}笔记{q ? ` · 搜索词：${q}` : ''}
          </div>
          <div className="row">
            <button className="chip-btn" type="button" disabled={currentState.loading} onClick={() => void refreshCurrentTab()}>
              刷新
            </button>
            <button className="chip-btn primary" type="button" disabled={currentState.loading || !currentState.hasMore} onClick={() => void loadMoreCurrentTab()}>
              加载更多
            </button>
          </div>
        </section>

        {currentState.loading && currentState.items.length === 0 ? <div className="center-hint">加载中...</div> : null}
        {currentState.error && currentState.items.length === 0 ? <div className="center-hint bad">{currentState.error}</div> : null}
        {!currentState.loading && !currentState.error && filteredItems.length === 0 ? <div className="center-hint">没有匹配内容</div> : null}
        {filteredItems.length ? (
          <section className="waterfall">
            {filteredItems.map((item) => (
              <FeedVideoCard
                key={`${tab}-${item.id}`}
                item={item}
                canLike={auth.isLoggedIn}
                busy={!!likeBusy[String(item.id)]}
                onToggleLike={(v) => void toggleLike(v, replaceItem)}
              />
            ))}
          </section>
        ) : null}
      </div>
    </AppShell>
  )
}
