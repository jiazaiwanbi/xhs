import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import AppShell from '../components/AppShell'
import AuthFrame from '../components/AuthFrame'
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
    if (!username || !password) return toast.error('请输入用户名和密码')
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
      <AuthFrame
        title="创建账号"
        subtitle="加入内容社区，记录和分享你的生活"
        closeTo="/account"
        footer={<button className="login-register" type="button" disabled={busy} onClick={() => void navigate('/account')}>已有账号，去登录</button>}
      >
        <label className="sr-only" htmlFor="register-username">用户名</label>
        <input id="register-username" value={form.username} placeholder="设置用户名" autoComplete="username" onChange={(e) => setForm((s) => ({ ...s, username: e.target.value.trim() }))} />
        <label className="sr-only" htmlFor="register-password">密码</label>
        <input id="register-password" value={form.password} type="password" placeholder="设置密码" autoComplete="new-password" onChange={(e) => setForm((s) => ({ ...s, password: e.target.value.trim() }))} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
        <button className="login-submit" type="button" disabled={busy} onClick={() => void submit()}>{busy ? '注册中…' : '注册'}</button>
        <p className="login-agreement">注册即代表同意《用户协议》和《隐私政策》</p>
      </AuthFrame>
    </AppShell>
  )
}
