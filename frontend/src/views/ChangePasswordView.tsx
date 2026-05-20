import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
import { useToast } from '../stores/toast'

export default function ChangePasswordView() {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', oldPassword: '', newPassword: '' })

  async function submit() {
    if (busy) return
    const username = form.username.trim()
    const oldPassword = form.oldPassword.trim()
    const newPassword = form.newPassword.trim()
    if (!username || !oldPassword || !newPassword) return toast.error('请把信息填完整')
    setBusy(true)
    try {
      await accountApi.changePassword(username, oldPassword, newPassword)
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
          <p className="subtle">不需要登录（对应后端 `/account/changePassword`）。</p>
          <div className="grid spaced">
            <label>username</label>
            <input value={form.username} autoComplete="username" onChange={(e) => setForm((s) => ({ ...s, username: e.target.value.trim() }))} />
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
