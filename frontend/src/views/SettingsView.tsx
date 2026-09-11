import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import type { Account } from '../api/types'
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
  const [profile, setProfile] = useState<Account | null>(null)
  const [bio, setBio] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState('')
  const avatarInput = useRef<HTMLInputElement>(null)
  const me = { id: auth.claims?.account_id ?? 0, username: auth.claims?.username ?? '' }

  useEffect(() => {
    if (!me.id) return
    void accountApi.findById(me.id).then((user) => {
      setProfile(user)
      setBio(user.bio ?? '')
    }).catch(() => undefined)
  }, [me.id])

  useEffect(() => {
    if (!avatarFile) return setAvatarPreview('')
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  async function submitRename() {
    if (!auth.isLoggedIn || busy) return
    const newUsername = rename.newUsername.trim()
    if (!newUsername) return toast.error('请输入新用户名')
    setBusy(true)
    try {
      const res = await accountApi.rename(newUsername)
      auth.setToken(res.token)
      setRename({ open: false, newUsername: '' })
      toast.success('用户名修改成功')
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

  async function saveProfile() {
    if (busy) return
    setBusy(true)
    try {
      let avatarUrl = profile?.avatar_url
      if (avatarFile) {
        const uploaded = await accountApi.uploadAvatar(avatarFile)
        avatarUrl = uploaded.avatar_url
      }
      await accountApi.updateProfile({ avatar_url: avatarUrl, bio: bio.trim() })
      setProfile((current) => ({ ...(current ?? { id: me.id, username: me.username }), avatar_url: avatarUrl, bio: bio.trim() }))
      setAvatarFile(null)
      if (avatarInput.current) avatarInput.current.value = ''
      toast.success('资料已保存')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell>
      <main className="settings-page">
        <header className="section-heading"><div><h1>编辑资料</h1><p>完善头像和简介，让大家更好地认识你</p></div><button className="quiet-btn" type="button" onClick={() => void navigate('/account')}>返回主页</button></header>
        <section className="settings-section profile-editor">
          <div className="avatar-editor">
            <UserAvatar username={me.username} id={me.id} src={avatarPreview || profile?.avatar_url} size={96} />
            <input ref={avatarInput} className="file-native" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setAvatarFile(event.target.files?.[0] ?? null)} />
            <button className="quiet-btn" type="button" disabled={busy} onClick={() => avatarInput.current?.click()}>更换头像</button>
          </div>
          <div className="settings-fields">
            <label>用户名</label>
            <div className="settings-inline"><div className="readonly-field">{me.username}</div><button className="quiet-btn" type="button" disabled={busy} onClick={() => setRename({ open: true, newUsername: me.username })}>修改</button></div>
            {rename.open ? (
              <div className="settings-inline edit-name-row">
                <input value={rename.newUsername} placeholder="输入新用户名" onChange={(e) => setRename((s) => ({ ...s, newUsername: e.target.value.trim() }))} onKeyDown={(e) => { if (e.key === 'Enter') void submitRename() }} />
                <button className="quiet-btn" type="button" disabled={busy} onClick={() => setRename((s) => ({ ...s, open: false }))}>取消</button><button className="primary" type="button" disabled={busy} onClick={() => void submitRename()}>确认</button>
              </div>
            ) : null}
            <label htmlFor="profile-bio">个人简介</label>
            <textarea id="profile-bio" value={bio} maxLength={160} placeholder="介绍一下自己吧" onChange={(event) => setBio(event.target.value)} />
            <div className="settings-actions"><span>{bio.length}/160</span><button className="primary" type="button" disabled={busy} onClick={() => void saveProfile()}>{busy ? '保存中…' : '保存资料'}</button></div>
          </div>
        </section>
        <section className="settings-section security-section">
          <div><h2>账号安全</h2><p>管理密码和当前登录状态</p></div>
          <div className="security-actions"><button className="quiet-btn" type="button" disabled={busy} onClick={() => void navigate('/account/change-password')}>修改密码</button><button className="danger-outline" type="button" disabled={busy} onClick={() => void onLogout()}>退出登录</button></div>
        </section>
      </main>
    </AppShell>
  )
}
