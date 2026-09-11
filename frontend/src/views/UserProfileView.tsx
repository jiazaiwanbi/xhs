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
  const receivedLikes = state.videos.reduce((total, video) => total + video.likes_count, 0)
  return (
    <AppShell>
      <main className="profile-page">
        <section className="profile-hero">
          <UserAvatar username={state.user?.username ?? 'User'} id={state.user?.id ?? userId} src={state.user?.avatar_url} size={176} />
          <div className="profile-info">
            <div className="profile-title-row">
              <h1>{state.user?.username ?? '加载中…'}</h1>
              <div className="profile-actions">
                {isMe ? <button className="profile-settings" type="button" onClick={() => void navigate('/settings')}>编辑资料</button> : (
              <>
                    <button className="profile-settings" type="button" disabled={!state.user || state.loading} onClick={() => void navigate(`/messages/${userId}`)}>私信</button>
                    <button className="follow-primary" type="button" disabled={!state.user || state.loading} onClick={() => void toggleFollow()}>{social.isFollowing(userId) ? '已关注' : '关注'}</button>
              </>
            )}
              </div>
            </div>
            <div className="profile-id">账号 ID：{state.user?.id ?? userId}</div>
            <p className={`profile-bio ${state.user?.bio ? '' : 'empty'}`}>{state.user?.bio || '还没有简介'}</p>
            <div className="profile-stats">
              <button type="button" disabled={!auth.isLoggedIn || state.socialLoading} onClick={() => setDrawer({ open: true, tab: 'following' })}><b>{auth.isLoggedIn ? (state.socialLoading ? '…' : state.vloggers.length) : '—'}</b><span>关注</span></button>
              <button type="button" disabled={!auth.isLoggedIn || state.socialLoading} onClick={() => setDrawer({ open: true, tab: 'followers' })}><b>{auth.isLoggedIn ? (state.socialLoading ? '…' : state.followers.length) : '—'}</b><span>粉丝</span></button>
              <div><b>{receivedLikes}</b><span>获赞</span></div>
            </div>
            {state.error ? <div className="hint bad spaced">{state.error}</div> : null}
            {state.socialError ? <div className="subtle spaced">社交信息加载失败：{state.socialError}</div> : null}
          </div>
        </section>
        <nav className="profile-tabs"><button className="active" type="button">发布的内容</button></nav>
        <section className="profile-content">
          {state.loading ? <div className="state-panel">正在加载主页…</div> : null}
          {!state.loading && !state.error && state.videos.length === 0 ? <div className="profile-empty"><div className="profile-empty-icon">⌁</div><p>这个账号还没有发布内容</p></div> : null}
          <div className="video-grid spaced">
          {state.videos.map((v) => (
            <button key={v.id} className="video-card" type="button" onClick={() => void navigate(`/video/${v.id}`)}>
              <img className="video-cover" src={v.cover_url} alt={v.title} loading="lazy" />
              <div className="video-meta"><div className="video-title">{v.title}</div><div className="video-sub subtle">♥ {v.likes_count} · {new Date(v.create_time).toLocaleDateString()}</div></div>
            </button>
          ))}
          </div>
        </section>
      </main>
      {drawer.open ? <UserDrawer title={drawer.tab === 'followers' ? '粉丝' : '关注'} items={listItems} loading={state.socialLoading} error={state.socialError} onClose={() => setDrawer((s) => ({ ...s, open: false }))} onUser={(id) => { setDrawer((s) => ({ ...s, open: false })); void navigate(`/u/${id}`) }} /> : null}
    </AppShell>
  )
}
