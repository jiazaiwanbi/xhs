import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
import { useToast } from '../stores/toast'

export default function RegisterView() {
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', password: '' })

  async function submit() {
    if (busy) return
    const username = form.username.trim()
    const password = form.password.trim()
    if (!username || !password) return toast.error('请输入 username 和 password')
    setBusy(true)
    try {
      await accountApi.register(username, password)
      toast.success('注册成功，请登录')
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
          <p className="title">注册</p>
          <p className="subtle">创建新账号（对应后端 `/account/register`）。</p>
          <div className="grid spaced">
            <label>username</label>
            <input value={form.username} autoComplete="username" onChange={(e) => setForm((s) => ({ ...s, username: e.target.value.trim() }))} />
            <label>password</label>
            <input value={form.password} type="password" autoComplete="new-password" onChange={(e) => setForm((s) => ({ ...s, password: e.target.value.trim() }))} />
            <div className="row end">
              <button className="primary" type="button" disabled={busy} onClick={() => void submit()}>
                注册
              </button>
            </div>
          </div>
        </div>
        <div className="card">
          <p className="title">提示</p>
          <p className="muted">注册成功后会跳回「账号」页进行登录。</p>
        </div>
      </div>
    </AppShell>
  )
}
