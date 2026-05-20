import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import * as socialApi from '../api/social'
import type { Account, Video } from '../api/types'
import * as videoApi from '../api/video'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'
import { UserDrawer } from './AccountView'

export default function UserProfileView() {
  const { id: rawId } = useParams()
  const userId = Number(rawId)
  const navigate = useNavigate()
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const myId = auth.claims?.account_id ?? 0
  const isMe = myId > 0 && myId === userId
  const [state, setState] = useState({ loading: false, error: '', user: null as Account | null, videos: [] as Video[], followers: [] as Account[], vloggers: [] as Account[], socialLoading: false, socialError: '' })
  const [drawer, setDrawer] = useState<{ open: boolean; tab: 'followers' | 'following' }>({ open: false, tab: 'followers' })

  async function loadSocialCounts() {
    setState((s) => ({ ...s, socialError: '', followers: [], vloggers: [] }))
    if (!auth.isLoggedIn || !Number.isFinite(userId) || userId <= 0) return
    setState((s) => ({ ...s, socialLoading: true }))
    try {
      const [followersRes, vloggersRes] = await Promise.all([socialApi.getAllFollowers(userId), socialApi.getAllVloggers(userId)])
      setState((s) => ({ ...s, followers: followersRes.followers, vloggers: vloggersRes.vloggers, socialLoading: false }))
    } catch (e) {
      setState((s) => ({ ...s, socialLoading: false, socialError: e instanceof ApiError ? e.message : String(e) }))
    }
  }

  async function loadProfile() {
    if (!Number.isFinite(userId) || userId <= 0) return setState((s) => ({ ...s, error: '无效的用户 id' }))
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [user, videos] = await Promise.all([accountApi.findById(userId), videoApi.listByAuthorId(userId)])
      setState((s) => ({ ...s, user, videos, loading: false }))
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e), user: null, videos: [] }))
    }
    await loadSocialCounts()
  }

  async function toggleFollow() {
    if (isMe) return
    if (!auth.isLoggedIn) {
      toast.error('请先登录')
      await navigate('/account')
      return
    }
    try {
      if (social.isFollowing(userId)) {
        await social.unfollow(userId)
        toast.info('已取关')
      } else {
        await social.follow(userId)
        toast.success('已关注')
      }
      await loadSocialCounts()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    }
  }

  useEffect(() => {
    setDrawer({ open: false, tab: 'followers' })
    void loadProfile()
  }, [rawId])

  useEffect(() => {
    void loadSocialCounts()
  }, [auth.isLoggedIn])

  const listItems = drawer.tab === 'followers' ? state.followers : state.vloggers
  return (
    <AppShell>
      <div className="card">
        <div className="row spread start">
          <div className="row avatar-head">
            <UserAvatar username={state.user?.username ?? 'User'} id={state.user?.id ?? userId} size={64} />
            <div>
              <div className="title">@{state.user?.username ?? '-'}</div>
              <div className="subtle mono">#{state.user?.id ?? userId}</div>
            </div>
          </div>
          <div className="row">
            {isMe ? <button className="ghost" type="button" onClick={() => void navigate('/account')}>我的账号</button> : (
              <>
                <button className="ghost" type="button" disabled={!state.user || state.loading} onClick={() => void navigate(`/messages/${userId}`)}>私信</button>
                <button className="primary" type="button" disabled={!state.user || state.loading} onClick={() => void toggleFollow()}>{social.isFollowing(userId) ? '已关注' : '关注'}</button>
              </>
            )}
          </div>
        </div>
        {state.loading ? <div className="hint spaced">加载中...</div> : null}
        {state.error ? <div className="hint bad spaced">{state.error}</div> : null}
        {!state.error ? (
          <div className="row spaced">
            <button className="metric" type="button" disabled={!auth.isLoggedIn || state.socialLoading} onClick={() => setDrawer({ open: true, tab: 'followers' })}>
              <div className="metric-num">{auth.isLoggedIn ? (state.socialLoading ? '...' : state.followers.length) : '-'}</div>
              <div className="metric-label">粉丝</div>
            </button>
            <button className="metric" type="button" disabled={!auth.isLoggedIn || state.socialLoading} onClick={() => setDrawer({ open: true, tab: 'following' })}>
              <div className="metric-num">{auth.isLoggedIn ? (state.socialLoading ? '...' : state.vloggers.length) : '-'}</div>
              <div className="metric-label">关注</div>
            </button>
            <div className="metric static"><div className="metric-num">{state.videos.length}</div><div className="metric-label">笔记</div></div>
            {!auth.isLoggedIn ? <div className="subtle">登录后可查看粉丝/关注列表</div> : null}
            {state.socialError ? <div className="subtle">社交信息加载失败：{state.socialError}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="card spaced">
        <div className="row spread"><p className="title">公开笔记</p><div className="subtle">点击封面进入笔记详情</div></div>
        {state.videos.length === 0 ? <div className="hint spaced">这个账号还没有发布笔记</div> : null}
        <div className="video-grid spaced">
          {state.videos.map((v) => (
            <button key={v.id} className="video-card" type="button" onClick={() => void navigate(`/video/${v.id}`)}>
              <img className="video-cover" src={v.cover_url} alt={v.title} loading="lazy" />
              <div className="video-meta"><div className="video-title">{v.title}</div><div className="video-sub subtle">♥ {v.likes_count} · {new Date(v.create_time).toLocaleDateString()}</div></div>
            </button>
          ))}
        </div>
      </div>
      {drawer.open ? <UserDrawer title={drawer.tab === 'followers' ? '粉丝' : '关注'} items={listItems} loading={state.socialLoading} error={state.socialError} onClose={() => setDrawer((s) => ({ ...s, open: false }))} onUser={(id) => { setDrawer((s) => ({ ...s, open: false })); void navigate(`/u/${id}`) }} /> : null}
    </AppShell>
  )
}
