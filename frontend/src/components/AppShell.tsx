import { useEffect, useMemo, useState, type ReactNode, type UIEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import Toaster from './Toaster'

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
          RedNote Demo
        </Link>
        <nav className="dy-nav">
          <NavLink className="dy-nav-link" to="/">
            最新
          </NavLink>
          <NavLink className="dy-nav-link" to="/hot">
            热榜
          </NavLink>
          <NavLink className="dy-nav-link" to="/video">
            发布笔记
          </NavLink>
          <NavLink className="dy-nav-link" to="/account">
            账号
          </NavLink>
          {auth.isLoggedIn ? (
            <NavLink className="dy-nav-link" to="/messages">
              私信
            </NavLink>
          ) : null}
          <NavLink className="dy-nav-link" to="/settings">
            设置
          </NavLink>
        </nav>
        <div className="dy-aside-foot">
          <div className="dy-user">
            <span className={`dy-user-dot ${auth.isLoggedIn ? 'ok' : 'bad'}`} />
            <span className="dy-user-name">{userLabel}</span>
          </div>
          <button className="dy-btn dy-btn-primary" type="button" onClick={() => void navigate(auth.isLoggedIn ? '/settings' : '/account')}>
            {auth.isLoggedIn ? '设置' : '登录'}
          </button>
        </div>
      </aside>

      <div className="dy-main">
        <header className="dy-topbar">
          <div className="dy-top-left">
            <div className="dy-tabs-hint">{location.pathname}</div>
          </div>
          <div className="dy-search">
            <input
              value={search}
              className="dy-search-input"
              placeholder="搜索标题 / 作者 / 文案（本地过滤）"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch()
              }}
            />
            <button className="dy-btn dy-btn-primary" type="button" onClick={onSearch}>
              搜索
            </button>
          </div>
          <div className="dy-top-right">
            <Link className="dy-btn dy-btn-ghost" to="/video">
              + 发布笔记
            </Link>
          </div>
        </header>

        <nav className="dy-mobile-nav">
          <NavLink className="dy-mobile-link" to="/">
            最新
          </NavLink>
          <NavLink className="dy-mobile-link" to="/hot">
            热榜
          </NavLink>
          <NavLink className="dy-mobile-link" to="/video">
            发布
          </NavLink>
          {auth.isLoggedIn ? (
            <NavLink className="dy-mobile-link" to="/messages">
              私信
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
