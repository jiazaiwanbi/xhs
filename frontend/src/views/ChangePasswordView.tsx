import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
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
      <div className="grid two">
        <div className="card">
          <p className="title">修改密码</p>
          <p className="subtle">当前账号：@{username}</p>
          <div className="grid spaced">
            <label>old_password</label>
            <input value={form.oldPassword} type="password" autoComplete="current-password" onChange={(e) => setForm((s) => ({ ...s, oldPassword: e.target.value.trim() }))} />
            <label>new_password</label>
            <input value={form.newPassword} type="password" autoComplete="new-password" onChange={(e) => setForm((s) => ({ ...s, newPassword: e.target.value.trim() }))} />
            <div className="row end">
              <button className="primary" type="button" disabled={busy} onClick={() => void submit()}>
                提交
              </button>
            </div>
          </div>
        </div>
        <div className="card">
          <p className="title">提示</p>
          <p className="muted">改密成功后后端会让旧 token 失效；请在「账号」页重新登录。</p>
        </div>
      </div>
    </AppShell>
  )
}
