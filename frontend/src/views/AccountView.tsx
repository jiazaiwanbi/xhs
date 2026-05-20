import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import * as likeApi from '../api/like'
import type { Account, Video } from '../api/types'
import * as videoApi from '../api/video'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

type VideoTab = 'works' | 'likes'
type ListTab = 'followers' | 'following'

export default function AccountView() {
  const navigate = useNavigate()
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [myVideos, setMyVideos] = useState({ loading: false, error: '', items: [] as Video[] })
  const [likedVideos, setLikedVideos] = useState({ loading: false, loaded: false, error: '', items: [] as Video[] })
  const [videoTab, setVideoTab] = useState<VideoTab>('works')
  const [drawer, setDrawer] = useState<{ open: boolean; tab: ListTab }>({ open: false, tab: 'followers' })
  const me = useMemo(() => ({ id: auth.claims?.account_id ?? 0, username: auth.claims?.username ?? '' }), [auth.claims])

  async function loadMyVideos() {
    if (!auth.isLoggedIn || !me.id) return setMyVideos({ loading: false, error: '', items: [] })
    setMyVideos((s) => ({ ...s, loading: true, error: '' }))
    try {
      const items = await videoApi.listByAuthorId(me.id)
      setMyVideos({ loading: false, error: '', items })
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

  useEffect(() => {
    if (auth.isLoggedIn && me.id) void loadMyVideos()
    if (!auth.isLoggedIn) {
      setDrawer({ open: false, tab: 'followers' })
      setVideoTab('works')
      setMyVideos({ loading: false, error: '', items: [] })
      setLikedVideos({ loading: false, loaded: false, error: '', items: [] })
    }
  }, [auth.isLoggedIn, me.id])

  const listTitle = drawer.tab === 'followers' ? '粉丝' : '关注'
  const listItems: Account[] = drawer.tab === 'followers' ? social.followers : social.vloggers
  const drawerLoading = drawer.tab === 'followers' ? social.followersLoading : social.vloggersLoading
  const drawerError = drawer.tab === 'followers' ? social.followersError : social.vloggersError
  const socialErrorHint = social.followersError || social.vloggersError

  return (
    <AppShell>
      {!auth.isLoggedIn ? (
        <div className="login-wrap">
          <div className="card login-card">
            <p className="title">登录</p>
            <div className="grid spaced">
              <label>username</label>
              <input value={loginForm.username} autoComplete="username" onChange={(e) => setLoginForm((s) => ({ ...s, username: e.target.value.trim() }))} />
              <label>password</label>
              <input
                value={loginForm.password}
                type="password"
                autoComplete="current-password"
                onChange={(e) => setLoginForm((s) => ({ ...s, password: e.target.value.trim() }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onLogin()
                }}
              />
              <button className="primary" type="button" disabled={busy} onClick={() => void onLogin()}>
                登录
              </button>
            </div>
            <div className="row spread spaced">
              <button className="ghost" type="button" disabled={busy} onClick={() => void navigate('/account/register')}>
                注册账号
              </button>
              <button className="ghost" type="button" disabled={busy} onClick={() => void navigate('/account/change-password')}>
                修改密码
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="row spread start">
              <div className="row avatar-head">
                <UserAvatar username={me.username} id={me.id} size={64} />
                <div>
                  <div className="title">@{me.username}</div>
                  <div className="subtle mono">#{me.id}</div>
                </div>
              </div>
              <button className="ghost" type="button" onClick={() => void navigate('/settings')}>
                设置
              </button>
            </div>
            <div className="row spaced">
              <button className="metric" type="button" disabled={social.followersLoading} onClick={() => setDrawer({ open: true, tab: 'followers' })}>
                <div className="metric-num">{social.followersLoading ? '...' : social.followerCount}</div>
                <div className="metric-label">粉丝</div>
              </button>
              <button className="metric" type="button" disabled={social.vloggersLoading} onClick={() => setDrawer({ open: true, tab: 'following' })}>
                <div className="metric-num">{social.vloggersLoading ? '...' : social.followingCount}</div>
                <div className="metric-label">关注</div>
              </button>
              <button className={`metric ${videoTab === 'works' ? 'active' : ''}`} type="button" onClick={() => { setVideoTab('works'); void loadMyVideos() }}>
                <div className="metric-num">{myVideos.loading ? '...' : myVideos.items.length}</div>
                <div className="metric-label">笔记</div>
              </button>
              <button className={`metric ${videoTab === 'likes' ? 'active' : ''}`} type="button" onClick={() => { setVideoTab('likes'); void loadLikedVideos() }}>
                <div className="metric-num">{likedVideos.loading ? '...' : likedVideos.loaded ? likedVideos.items.length : '-'}</div>
                <div className="metric-label">赞过</div>
              </button>
              {socialErrorHint ? <div className="subtle">社交信息加载失败：{socialErrorHint}</div> : null}
            </div>
          </div>
          <VideoGrid title={videoTab === 'works' ? '我的笔记' : '赞过的笔记'} loading={videoTab === 'works' ? myVideos.loading : likedVideos.loading} error={videoTab === 'works' ? myVideos.error : likedVideos.error} items={videoTab === 'works' ? myVideos.items : likedVideos.items} empty={videoTab === 'works' ? '还没有发布笔记' : '还没有收藏喜欢的笔记'} />
        </>
      )}
      {drawer.open ? (
        <UserDrawer title={listTitle} items={listItems} loading={drawerLoading} error={drawerError} onClose={() => setDrawer((s) => ({ ...s, open: false }))} onUser={(id) => { setDrawer((s) => ({ ...s, open: false })); void navigate(`/u/${id}`) }} />
      ) : null}
    </AppShell>
  )
}

function VideoGrid({ title, loading, error, items, empty }: { title: string; loading: boolean; error: string; items: Video[]; empty: string }) {
  const navigate = useNavigate()
  return (
    <div className="card spaced">
      <div className="row spread">
        <p className="title">{title}</p>
        <div className="subtle">点击封面进入笔记详情</div>
      </div>
      {loading ? <div className="hint spaced">加载中...</div> : null}
      {error ? <div className="hint bad spaced">{error}</div> : null}
      {!loading && !error && items.length === 0 ? <div className="hint spaced">{empty}</div> : null}
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
    </div>
  )
}

export function UserDrawer({ title, items, loading, error, onClose, onUser }: { title: string; items: Account[]; loading: boolean; error: string; onClose: () => void; onUser: (id: number) => void }) {
  return (
    <div className="drawer-backdrop" onClick={(event) => event.currentTarget === event.target && onClose()}>
      <div className="drawer">
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <button className="drawer-x" type="button" onClick={onClose}>
            x
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
                <div className="user-id mono">#{u.id}</div>
              </div>
            </button>
          )) : null}
        </div>
      </div>
    </div>
  )
}
