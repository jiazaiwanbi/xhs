import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '../api/client'
import type { Video } from '../api/types'
import * as videoApi from '../api/video'
import AppShell from '../components/AppShell'
import { useAuth } from '../stores/auth'
import { useToast } from '../stores/toast'

export default function VideoView() {
  const auth = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const coverInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [published, setPublished] = useState<Video | null>(null)
  const [form, setForm] = useState<{ title: string; description: string; cover: File | null; notifyFollowers: boolean }>({
    title: '',
    description: '',
    cover: null,
    notifyFollowers: false,
  })
  const [preview, setPreview] = useState('')

  useEffect(() => {
    if (!form.cover) {
      setPreview('')
      return
    }
    const url = URL.createObjectURL(form.cover)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [form.cover])

  async function onPublish() {
    if (busy) return
    if (!auth.isLoggedIn) {
      toast.error('请先登录')
      await navigate('/account')
      return
    }
    const title = form.title.trim()
    const description = form.description.trim()
    if (!title) return toast.error('请输入标题')
    if (!form.cover) return toast.error('请选择笔记主图（jpg/png/webp）')
    setBusy(true)
    setPublished(null)
    try {
      setStage('上传图片')
      const coverRes = await videoApi.uploadCover(form.cover)
      const coverUrl = coverRes.url || coverRes.cover_url || ''
      if (!coverUrl) return toast.error('上传成功但缺少图片 URL')
      setStage('发布笔记')
      const res = await videoApi.publishVideo({
        title,
        description,
        play_url: coverUrl,
        cover_url: coverUrl,
        notify_followers: form.notifyFollowers,
      })
      setPublished(res)
      setForm({ title: '', description: '', cover: null, notifyFollowers: false })
      if (coverInput.current) coverInput.current.value = ''
      toast.success('笔记已发布')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  return (
    <AppShell>
      <div className="publish-wrap">
        <div className="card publish-card">
          <div className="row spread baseline">
            <p className="title">发布图文笔记</p>
            {busy ? <div className="pill">进行中：{stage || '...'}</div> : null}
          </div>
          <p className="subtle spaced">这里已经切成“小红书式图文发布”。为了快速演示，前端只上传一张主图，然后继续复用原来的 `/video/publish` 接口入库。</p>
          <div className="grid form-grid spaced">
            <label>标题</label>
            <input className="big-input" value={form.title} disabled={busy} placeholder="例如：周末在安福路拍到的秋天光影" onChange={(e) => setForm((s) => ({ ...s, title: e.target.value.trimStart() }))} />
            <label>正文</label>
            <textarea className="big-input" value={form.description} disabled={busy} placeholder="写下这条图文笔记的内容、心得、穿搭、探店、旅行记录……" onChange={(e) => setForm((s) => ({ ...s, description: e.target.value.trimStart() }))} />
            <label>主图 (jpg/png/webp)</label>
            <input ref={coverInput} className="file-native" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => setForm((s) => ({ ...s, cover: e.target.files?.[0] ?? null }))} />
            <div className="file-box">
              <button type="button" disabled={busy} onClick={() => coverInput.current?.click()}>
                选择主图
              </button>
              <div className={`file-name ${form.cover ? '' : 'muted'}`}>{form.cover ? form.cover.name : '未选择图片'}</div>
              {form.cover ? (
                <button type="button" disabled={busy} onClick={() => setForm((s) => ({ ...s, cover: null }))}>
                  清除
                </button>
              ) : null}
            </div>
            {preview ? (
              <div className="preview-card">
                <div className="subtle">笔记主图预览</div>
                <img className="cover-preview" src={preview} alt="cover preview" />
              </div>
            ) : null}
            <label className="row" style={{ gap: 10, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.notifyFollowers}
                disabled={busy}
                onChange={(e) => setForm((s) => ({ ...s, notifyFollowers: e.target.checked }))}
              />
              <span>同时通知粉丝</span>
            </label>
            <div className="row end">
              <button className="primary big-btn" type="button" disabled={busy} onClick={() => void onPublish()}>
                发布笔记
              </button>
            </div>
          </div>
          {published ? (
            <div className="card spaced">
              <p className="title">已发布的笔记</p>
              <div className="row spread">
                <div>
                  <div className="title">{published.title}</div>
                  <div className="subtle mono">#{published.id}</div>
                </div>
                <div className="row">
                  <Link className="pill" to={`/video/${published.id}`}>
                    查看笔记
                  </Link>
                  <a className="pill mono" href={published.cover_url} target="_blank" rel="noreferrer">
                    image_url
                  </a>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppShell>
  )
}
