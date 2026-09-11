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
        content_type: 'image',
        image_urls: [coverUrl],
        play_url: '',
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
      <main className="publish-page">
        <header className="section-heading"><div><h1>发布内容</h1><p>分享此刻的灵感与生活</p></div>{busy ? <span className="status-chip">{stage || '处理中…'}</span> : null}</header>
        <section className="publish-layout">
          <div className="publish-media">
            <input ref={coverInput} className="file-native" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(e) => setForm((s) => ({ ...s, cover: e.target.files?.[0] ?? null }))} />
            {preview ? (
              <div className="publish-preview"><img src={preview} alt="主图预览" /><button type="button" onClick={() => setForm((s) => ({ ...s, cover: null }))}>重新选择</button></div>
            ) : (
              <button className="upload-zone" type="button" disabled={busy} onClick={() => coverInput.current?.click()}><span>＋</span><b>上传主图</b><small>支持 JPG、PNG、WebP</small></button>
            )}
          </div>
          <div className="publish-form">
            <label htmlFor="publish-title">标题</label>
            <input id="publish-title" className="big-input" value={form.title} disabled={busy} placeholder="填写一个吸引人的标题" onChange={(e) => setForm((s) => ({ ...s, title: e.target.value.trimStart() }))} />
            <label htmlFor="publish-copy">正文</label>
            <textarea id="publish-copy" className="big-input" value={form.description} disabled={busy} placeholder="写下你的内容、心得和故事……" onChange={(e) => setForm((s) => ({ ...s, description: e.target.value.trimStart() }))} />
            <label className="notify-toggle">
              <input
                type="checkbox"
                checked={form.notifyFollowers}
                disabled={busy}
                onChange={(e) => setForm((s) => ({ ...s, notifyFollowers: e.target.checked }))}
              />
              <span>同时通知粉丝</span>
            </label>
            <div className="publish-actions">
              <button className="primary big-btn" type="button" disabled={busy} onClick={() => void onPublish()}>
                {busy ? '发布中…' : '发布内容'}
              </button>
            </div>
          </div>
        </section>
        {published ? <div className="publish-success"><span>发布成功</span><b>{published.title}</b><Link to={`/video/${published.id}`}>查看内容</Link></div> : null}
      </main>
    </AppShell>
  )
}
