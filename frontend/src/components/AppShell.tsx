import { useEffect, useMemo, useState, type ReactNode, type UIEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../stores/auth'
import { useNotification } from '../stores/notification'
import { useSocial } from '../stores/social'
import Toaster from './Toaster'
import Icon from './Icon'

export default function AppShell({
  full = false,
  children,
  onContentScroll,
}: {
  full?: boolean
  children: ReactNode
  onContentScroll?: (event: UIEvent<HTMLDivElement>) => void
}) {
  const auth = useAuth()
  const notifications = useNotification()
  const social = useSocial()
  const navigate = useNavigate()
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const [search, setSearch] = useState(params.get('q') ?? '')

  useEffect(() => {
    setSearch(new URLSearchParams(location.search).get('q') ?? '')
  }, [location.search])

  useEffect(() => {
    if (auth.isLoggedIn) void social.refreshMine()
    else social.clear()
  }, [auth.isLoggedIn])

  const userLabel = useMemo(() => {
    if (!auth.isLoggedIn) return '未登录'
    const username = auth.claims?.username ?? '(unknown)'
    const accountId = auth.claims?.account_id
    return accountId ? `${username} #${accountId}` : username
  }, [auth.claims, auth.isLoggedIn])

  function onSearch() {
    const q = search.trim()
    void navigate(q ? `/?q=${encodeURIComponent(q)}` : '/')
  }

  return (
    <div className="dy-shell">
      <aside className="dy-aside">
        <Link className="dy-logo" to="/">
          内容社区
        </Link>
        <nav className="dy-nav">
          <NavLink className="dy-nav-link" to="/">
            <Icon name="home" /><span>发现</span>
          </NavLink>
          <NavLink className="dy-nav-link" to="/video" end>
            <Icon name="camera" /><span>发布</span>
          </NavLink>
          <NavLink className="dy-nav-link" to="/messages">
            <Icon name="bell" /><span>通知</span>{auth.isLoggedIn && notifications.unreadCount > 0 ? <b className="dy-badge">{notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}</b> : null}
          </NavLink>
          <NavLink className="dy-nav-link" to="/messages">
            <Icon name="message" /><span>消息</span>
          </NavLink>
          <NavLink className="dy-nav-link" to="/account">
            <Icon name="user" /><span>我的</span>
          </NavLink>
        </nav>
        <div className="dy-aside-foot">
          <button className="dy-btn dy-btn-primary" type="button" onClick={() => void navigate('/account')}>
            {auth.isLoggedIn ? userLabel : '登录'}
          </button>
        </div>
      </aside>

      <div className="dy-main">
        <header className="dy-topbar">
          <div className="dy-top-left" />
          <div className="dy-search">
            <input
              value={search}
              className="dy-search-input"
              placeholder="登录探索更多内容"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch()
              }}
            />
            <button className="search-button" type="button" onClick={onSearch} aria-label="搜索"><Icon name="search" /></button>
          </div>
          <div className="dy-top-right" />
        </header>

        <nav className="dy-mobile-nav">
          <NavLink className="dy-mobile-link" to="/">
            首页
          </NavLink>
          <NavLink className="dy-mobile-link" to="/video" end>
            发布
          </NavLink>
          {auth.isLoggedIn ? (
            <NavLink className="dy-mobile-link" to="/messages">
              消息
            </NavLink>
          ) : null}
          <NavLink className="dy-mobile-link" to="/account">
            账号
          </NavLink>
        </nav>

        <div className={`dy-content ${full ? 'full' : 'padded'}`} onScroll={onContentScroll}>
          {full ? children : <div className="container">{children}</div>}
        </div>
      </div>
      <Toaster />
    </div>
  )
}
