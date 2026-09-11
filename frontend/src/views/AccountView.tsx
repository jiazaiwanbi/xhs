import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import * as likeApi from '../api/like'
import type { Account, Video } from '../api/types'
import * as videoApi from '../api/video'
import AppShell from '../components/AppShell'
import AuthFrame from '../components/AuthFrame'
import Icon from '../components/Icon'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

type VideoTab = 'works' | 'likes'
type ListTab = 'followers' | 'following'
type AuthMode = 'login' | 'register'

export default function AccountView() {
  const navigate = useNavigate()
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [profile, setProfile] = useState<Account | null>(null)
  const [myVideos, setMyVideos] = useState({ loading: false, error: '', items: [] as Video[] })
  const [likedVideos, setLikedVideos] = useState({ loading: false, loaded: false, error: '', items: [] as Video[] })
  const [videoTab, setVideoTab] = useState<VideoTab>('works')
  const [drawer, setDrawer] = useState<{ open: boolean; tab: ListTab }>({ open: false, tab: 'followers' })
  const me = useMemo(() => ({ id: auth.claims?.account_id ?? 0, username: auth.claims?.username ?? '' }), [auth.claims])

  async function loadMyVideos() {
    if (!auth.isLoggedIn || !me.id) return setMyVideos({ loading: false, error: '', items: [] })
    setMyVideos((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [items, user] = await Promise.all([videoApi.listByAuthorId(me.id), accountApi.findById(me.id)])
      setMyVideos({ loading: false, error: '', items })
      setProfile(user)
    } catch (e) {
      setMyVideos({ loading: false, error: e instanceof ApiError ? e.message : String(e), items: [] })
    }
  }

  async function loadLikedVideos() {
    if (!auth.isLoggedIn || !me.id) return setLikedVideos({ loading: false, loaded: false, error: '', items: [] })
    setLikedVideos((s) => ({ ...s, loading: true, error: '' }))
    try {
      const items = await likeApi.listMyLikedVideos()
      setLikedVideos({ loading: false, loaded: true, error: '', items })
    } catch (e) {
      setLikedVideos({ loading: false, loaded: true, error: e instanceof ApiError ? e.message : String(e), items: [] })
    }
  }

  async function onLogin() {
    if (busy) return
    const username = loginForm.username.trim()
    const password = loginForm.password.trim()
    if (!username || !password) return toast.error('请输入用户名和密码')
    setBusy(true)
    try {
      const res = await accountApi.login(username, password)
      auth.setTokens(res.token, res.refresh_token ?? '')
      toast.success('登录成功')
      await social.refreshMine()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onRegister() {
    if (busy) return
    const username = loginForm.username.trim()
    const password = loginForm.password.trim()
    if (!username || !password) return toast.error('请输入用户名和密码')
    setBusy(true)
    try {
      await accountApi.register(username, password)
      setLoginForm({ username, password: '' })
      setAuthMode('login')
      toast.success('注册成功，请登录')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function switchAuthMode(mode: AuthMode) {
    if (busy) return
    setAuthMode(mode)
    setLoginForm((current) => ({ ...current, password: '' }))
  }

  useEffect(() => {
    if (auth.isLoggedIn && me.id) void loadMyVideos()
    if (!auth.isLoggedIn) {
      setDrawer({ open: false, tab: 'followers' })
      setVideoTab('works')
      setProfile(null)
      setMyVideos({ loading: false, error: '', items: [] })
      setLikedVideos({ loading: false, loaded: false, error: '', items: [] })
    }
  }, [auth.isLoggedIn, me.id])

  useEffect(() => {
    if (auth.isLoggedIn) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void navigate('/')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [auth.isLoggedIn, navigate])

  const listTitle = drawer.tab === 'followers' ? '粉丝' : '关注'
  const listItems: Account[] = drawer.tab === 'followers' ? social.followers : social.vloggers
  const drawerLoading = drawer.tab === 'followers' ? social.followersLoading : social.vloggersLoading
  const drawerError = drawer.tab === 'followers' ? social.followersError : social.vloggersError
  const socialErrorHint = social.followersError || social.vloggersError
  const receivedLikes = myVideos.items.reduce((total, item) => total + item.likes_count, 0)

  return (
    <AppShell>
      {!auth.isLoggedIn ? (
        <AuthFrame
          title={authMode === 'login' ? '账号登录' : '创建账号'}
          subtitle={authMode === 'login' ? '登录后即可点赞、评论与关注喜欢的创作者' : '加入内容社区，记录和分享你的生活'}
          footer={authMode === 'login'
            ? <button className="login-register" type="button" disabled={busy} onClick={() => switchAuthMode('register')}>新用户注册</button>
            : <button className="login-register" type="button" disabled={busy} onClick={() => switchAuthMode('login')}>已有账号，去登录</button>}
        >
              <label className="sr-only" htmlFor="account-username">用户名</label>
              <input id="account-username" value={loginForm.username} placeholder={authMode === 'login' ? '输入用户名' : '设置用户名'} autoComplete="username" onChange={(e) => setLoginForm((s) => ({ ...s, username: e.target.value.trim() }))} />
              <label className="sr-only" htmlFor="account-password">密码</label>
              <input
                id="account-password"
                value={loginForm.password}
                type="password"
                placeholder={authMode === 'login' ? '输入密码' : '设置密码'}
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value.trim() }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void (authMode === 'login' ? onLogin() : onRegister())
                }}
              />
              <button className="login-submit" type="button" disabled={busy} onClick={() => void (authMode === 'login' ? onLogin() : onRegister())}>{busy ? (authMode === 'login' ? '登录中…' : '注册中…') : (authMode === 'login' ? '登录' : '注册')}</button>
              <p className="login-agreement">{authMode === 'login' ? '登录' : '注册'}即代表同意《用户协议》和《隐私政策》</p>
        </AuthFrame>
      ) : (
        <main className="profile-page">
          <section className="profile-hero">
            <UserAvatar username={profile?.username ?? me.username} id={me.id} src={profile?.avatar_url} size={176} />
            <div className="profile-info">
              <div className="profile-title-row">
                <h1>{profile?.username ?? me.username}</h1>
                <button className="profile-settings" type="button" onClick={() => void navigate('/settings')}>编辑资料</button>
              </div>
              <div className="profile-id">账号 ID：{me.id}</div>
              <p className={`profile-bio ${profile?.bio ? '' : 'empty'}`}>{profile?.bio || '还没有简介'}</p>
              <div className="profile-stats">
                <button type="button" disabled={social.vloggersLoading} onClick={() => setDrawer({ open: true, tab: 'following' })}><b>{social.vloggersLoading ? '…' : social.followingCount}</b><span>关注</span></button>
                <button type="button" disabled={social.followersLoading} onClick={() => setDrawer({ open: true, tab: 'followers' })}><b>{social.followersLoading ? '…' : social.followerCount}</b><span>粉丝</span></button>
                <div><b>{receivedLikes}</b><span>获赞</span></div>
              </div>
              {socialErrorHint ? <div className="subtle">社交信息加载失败：{socialErrorHint}</div> : null}
            </div>
          </section>
          <nav className="profile-tabs" aria-label="个人内容">
            <button className={videoTab === 'works' ? 'active' : ''} type="button" onClick={() => { setVideoTab('works'); void loadMyVideos() }}>发布的内容</button>
            <button className={videoTab === 'likes' ? 'active' : ''} type="button" onClick={() => { setVideoTab('likes'); void loadLikedVideos() }}>喜欢过的内容</button>
          </nav>
          <VideoGrid loading={videoTab === 'works' ? myVideos.loading : likedVideos.loading} error={videoTab === 'works' ? myVideos.error : likedVideos.error} items={videoTab === 'works' ? myVideos.items : likedVideos.items} empty={videoTab === 'works' ? '你还没有发布任何内容' : '你还没有喜欢过任何内容'} />
        </main>
      )}
      {drawer.open ? (
        <UserDrawer title={listTitle} items={listItems} loading={drawerLoading} error={drawerError} onClose={() => setDrawer((s) => ({ ...s, open: false }))} onUser={(id) => { setDrawer((s) => ({ ...s, open: false })); void navigate(`/u/${id}`) }} />
      ) : null}
    </AppShell>
  )
}

function VideoGrid({ loading, error, items, empty }: { loading: boolean; error: string; items: Video[]; empty: string }) {
  const navigate = useNavigate()
  return (
    <section className="profile-content">
      {loading ? <div className="hint spaced">加载中...</div> : null}
      {error ? <div className="hint bad spaced">{error}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="profile-empty"><div className="profile-empty-icon">⌁</div><p>{empty}</p></div> : null}
      {items.length ? (
        <div className="video-grid spaced">
          {items.map((v) => (
            <button key={v.id} className="video-card" type="button" onClick={() => void navigate(`/video/${v.id}`)}>
              <img className="video-cover" src={v.cover_url} alt={v.title} loading="lazy" />
              <div className="video-meta">
                <div className="video-title">{v.title}</div>
                <div className="video-sub subtle">♥ {v.likes_count} · {new Date(v.create_time).toLocaleDateString()}</div>
              </div>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function UserDrawer({ title, items, loading, error, onClose, onUser }: { title: string; items: Account[]; loading: boolean; error: string; onClose: () => void; onUser: (id: number) => void }) {
  return (
    <div className="drawer-backdrop" onClick={(event) => event.currentTarget === event.target && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button className="drawer-x" type="button" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="drawer-body">
          {loading ? <div className="drawer-hint">加载中...</div> : null}
          {error ? <div className="drawer-hint bad">{error}</div> : null}
          {!loading && !error && items.length === 0 ? <div className="drawer-hint">暂无</div> : null}
          {!loading && !error ? items.map((u) => (
            <button key={u.id} className="user-row" type="button" onClick={() => onUser(u.id)}>
              <UserAvatar username={u.username} id={u.id} size={40} />
              <div className="user-meta">
                <div className="user-name">@{u.username}</div>
                <div className="user-id">查看个人主页</div>
              </div>
            </button>
          )) : null}
        </div>
      </div>
    </div>
  )
}
