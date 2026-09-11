import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
import AuthFrame from '../components/AuthFrame'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/toast'

export default function ChangePasswordView() {
  const navigate = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ oldPassword: '', newPassword: '' })
  const username = auth.claims?.username ?? ''

  async function submit() {
    if (busy) return
    const oldPassword = form.oldPassword.trim()
    const newPassword = form.newPassword.trim()
    if (!username) return toast.error('登录信息已失效，请重新登录')
    if (!oldPassword || !newPassword) return toast.error('请把信息填完整')
    setBusy(true)
    try {
      await accountApi.changePassword(username, oldPassword, newPassword)
      auth.clearTokens()
      toast.success('密码已修改，请重新登录')
      await navigate('/account')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <AuthFrame title="修改密码" subtitle={`当前账号：${username}`} closeTo="/settings">
        <label className="sr-only" htmlFor="current-password">当前密码</label>
        <input id="current-password" value={form.oldPassword} type="password" placeholder="输入当前密码" autoComplete="current-password" onChange={(e) => setForm((s) => ({ ...s, oldPassword: e.target.value.trim() }))} />
        <label className="sr-only" htmlFor="new-password">新密码</label>
        <input id="new-password" value={form.newPassword} type="password" placeholder="设置新密码" autoComplete="new-password" onChange={(e) => setForm((s) => ({ ...s, newPassword: e.target.value.trim() }))} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        <button className="login-submit" type="button" disabled={busy} onClick={() => void submit()}>{busy ? '提交中…' : '确认修改'}</button>
        <p className="login-agreement">修改成功后，需要使用新密码重新登录</p>
      </AuthFrame>
    </AppShell>
  )
}
