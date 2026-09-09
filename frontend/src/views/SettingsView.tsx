import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/toast'

export default function SettingsView() {
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [rename, setRename] = useState({ open: false, newUsername: '' })
  const me = { id: auth.claims?.account_id ?? 0, username: auth.claims?.username ?? '' }

  async function submitRename() {
    if (!auth.isLoggedIn || busy) return
    const newUsername = rename.newUsername.trim()
    if (!newUsername) return toast.error('请输入新用户名')
    setBusy(true)
    try {
      const res = await accountApi.rename(newUsername)
      auth.setToken(res.token)
      setRename({ open: false, newUsername: '' })
      toast.success('改名成功（已刷新 token）')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onLogout() {
    if (!auth.isLoggedIn || busy) return
    if (!window.confirm('确认退出登录？')) return
    setBusy(true)
    try {
      await accountApi.logout()
    } catch (e) {
      toast.error(`登出失败：${e instanceof ApiError ? e.message : String(e)}`)
    } finally {
      auth.clearTokens()
      setRename({ open: false, newUsername: '' })
      toast.info('已退出登录')
      setBusy(false)
      await navigate('/')
    }
  }

  return (
    <AppShell>
      <div className="grid two">
        <div className="card">
          <div className="row spread start">
            <div className="row avatar-head">
              <UserAvatar username={me.username} id={me.id} size={56} />
              <div><div className="title">@{me.username}</div><div className="subtle mono">#{me.id}</div></div>
            </div>
          </div>
          <div className="card spaced">
            <div className="row spread"><p className="title">账号设置</p><button className="ghost" type="button" disabled={busy} onClick={() => setRename({ open: true, newUsername: me.username })}>改名</button></div>
            {rename.open ? (
              <div className="grid spaced">
                <label>new_username</label>
                <input value={rename.newUsername} onChange={(e) => setRename((s) => ({ ...s, newUsername: e.target.value.trim() }))} onKeyDown={(e) => { if (e.key === 'Enter') void submitRename() }} />
                <div className="row end"><button type="button" disabled={busy} onClick={() => setRename((s) => ({ ...s, open: false }))}>取消</button><button className="primary" type="button" disabled={busy} onClick={() => void submitRename()}>提交</button></div>
              </div>
            ) : null}
          </div>
          <div className="card spaced">
            <p className="title">账号安全</p>
            <div className="row"><button className="ghost" type="button" disabled={busy} onClick={() => void navigate('/account/change-password')}>修改密码</button><button className="danger" type="button" disabled={busy} onClick={() => void onLogout()}>退出登录</button></div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
