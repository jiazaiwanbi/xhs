import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as commentApi from '../api/comment'
import * as likeApi from '../api/like'
import type { Comment, Video } from '../api/types'
import * as videoApi from '../api/video'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import Icon from '../components/Icon'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

export default function VideoDetailView() {
  const { id: rawId } = useParams()
  const id = Number(rawId)
  const navigate = useNavigate()
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const [state, setState] = useState({ loading: false, error: '', video: null as Video | null, isLiked: null as boolean | null, busy: false })
  const [comments, setComments] = useState({ loading: false, error: '', list: [] as Comment[], content: '' })

  async function needLogin() {
    toast.error('请先登录')
    await navigate('/account')
  }

  async function loadVideo() {
    if (!Number.isFinite(id) || id <= 0) return setState((s) => ({ ...s, error: '无效的笔记 id' }))
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const video = await videoApi.getDetail(id)
      setState((s) => ({ ...s, loading: false, video }))
      await loadComments(video.id)
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }

  async function loadIsLiked() {
    if (!auth.isLoggedIn) return setState((s) => ({ ...s, isLiked: null }))
    try {
      const res = await likeApi.isLiked(id)
      setState((s) => ({ ...s, isLiked: res.is_liked }))
    } catch {
      setState((s) => ({ ...s, isLiked: null }))
    }
  }

  async function loadComments(videoId = state.video?.id) {
    if (!videoId) return
    setComments((s) => ({ ...s, loading: true, error: '' }))
    try {
      const list = await commentApi.listAll(videoId)
      setComments((s) => ({ ...s, loading: false, list }))
    } catch (e) {
      setComments((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e) }))
    }
  }

  async function toggleLike() {
    if (!state.video) return
    if (!auth.isLoggedIn) return needLogin()
    if (state.busy) return
    setState((s) => ({ ...s, busy: true }))
    try {
      if (state.isLiked) await likeApi.unlike(id)
      else await likeApi.like(id)
      setState((s) => s.video ? ({ ...s, busy: false, isLiked: !s.isLiked, video: { ...s.video, likes_count: Math.max(0, s.video.likes_count + (!s.isLiked ? 1 : -1)) } }) : s)
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
      setState((s) => ({ ...s, busy: false }))
    }
  }

  async function toggleFollow() {
    if (!state.video) return
    if (!auth.isLoggedIn) return needLogin()
    if (auth.claims?.account_id === state.video.author_id) return
    setState((s) => ({ ...s, busy: true }))
    try {
      if (social.isFollowing(state.video.author_id)) {
        await social.unfollow(state.video.author_id)
        toast.info('已取关')
      } else {
        await social.follow(state.video.author_id)
        toast.success('已关注')
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
    } finally {
      setState((s) => ({ ...s, busy: false }))
    }
  }

  async function share() {
    if (!state.video) return
    const url = `${location.origin}/video/${state.video.id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success('链接已复制')
    } catch {
      window.prompt('复制链接', url)
    }
  }

  async function publishComment() {
    if (!state.video) return
    if (!auth.isLoggedIn) return needLogin()
    const content = comments.content.trim()
    if (!content) return
    setComments((s) => ({ ...s, loading: true, error: '' }))
    try {
      await commentApi.publish(state.video.id, content)
      setComments((s) => ({ ...s, content: '' }))
      await loadComments()
      toast.success('评论已发布')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e)
      setComments((s) => ({ ...s, loading: false, error: msg }))
      toast.error(msg)
    }
  }

  async function deleteComment(commentId: number) {
    if (!auth.isLoggedIn) return needLogin()
    if (!window.confirm('确认删除这条评论？')) return
    setComments((s) => ({ ...s, loading: true, error: '' }))
    try {
      await commentApi.remove(commentId)
      await loadComments()
      toast.info('评论已删除')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e)
      setComments((s) => ({ ...s, loading: false, error: msg }))
      toast.error(msg)
    }
  }

  useEffect(() => {
    void loadVideo()
    void loadIsLiked()
  }, [rawId])

  useEffect(() => {
    void loadIsLiked()
  }, [auth.isLoggedIn])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void navigate('/')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  const video = state.video
  return (
    <AppShell full>
      <div className="detail-page" role="dialog" aria-modal="true" aria-label="笔记详情" onMouseDown={(event) => event.currentTarget === event.target && void navigate('/')}>
        <button className="detail-close" type="button" onClick={() => void navigate('/')} aria-label="关闭"><Icon name="close" size={28} /></button>
        {state.loading ? <div className="center-hint">加载中...</div> : null}
        {state.error ? <div className="center-hint bad">{state.error}</div> : null}
        {video ? (
          <div className="note-reader">
            <section className="media-panel">
              <video className="note-cover" src={video.play_url} poster={video.cover_url} controls playsInline aria-label={video.title} />
            </section>
            <aside className="detail-panel">
              <section className="note-info">
                <div className="author-bar">
                  <Link className="author-link" to={`/u/${video.author_id}`}>
                    <UserAvatar username={video.username} id={video.author_id} size={44} />
                    <span className="author-name">{video.username}</span>
                  </Link>
                  {auth.claims?.account_id !== video.author_id ? (
                    <button className="follow-btn" type="button" disabled={state.busy} onClick={() => void toggleFollow()}>
                      {social.isFollowing(video.author_id) ? '已关注' : '关注'}
                    </button>
                  ) : null}
                </div>
                <div className="note-copy detail-copy">
                  <h1 className="detail-title">{video.title}</h1>
                  {video.description ? <p className="desc">{video.description}</p> : null}
                  <div className="meta-line">
                    <span>{new Date(video.create_time).toLocaleString()}</span>
                    <span>编辑于 {new Date(video.create_time).toLocaleDateString()}</span>
                  </div>
                </div>
              </section>
              <section className="comment-panel">
                <div className="comment-title">
                  <span>共 {comments.list.length} 条评论</span>
                </div>
                <div className="comment-composer">
                  <textarea
                    value={comments.content}
                    placeholder="说点什么..."
                    disabled={comments.loading}
                    onChange={(e) => setComments((s) => ({ ...s, content: e.target.value }))}
                  />
                  <div className="row spread">
                    <span className="subtle">{auth.isLoggedIn ? '评论会发布到当前笔记' : '登录后可以发表评论'}</span>
                    <button className="primary send-btn" type="button" disabled={comments.loading || !comments.content.trim()} onClick={() => void publishComment()}>
                      发送
                    </button>
                  </div>
                </div>
                <div className="comment-list">
                  {comments.loading ? <div className="drawer-hint">加载中...</div> : null}
                  {comments.error ? <div className="drawer-hint bad">{comments.error}</div> : null}
                  {!comments.loading && !comments.error && comments.list.length === 0 ? <div className="drawer-hint">暂无评论，来坐第一排。</div> : null}
                  {comments.list.map((c) => (
                    <article className="comment" key={c.id}>
                      <UserAvatar username={c.username} id={c.author_id} size={42} />
                      <div className="comment-body">
                        <div className="comment-top">
                          <span className="comment-user">{c.username}</span>
                          {auth.claims?.account_id === c.author_id ? <button className="more-btn danger" type="button" disabled={comments.loading} onClick={() => void deleteComment(c.id)}>删除</button> : null}
                        </div>
                        <div className="comment-content">{c.content}</div>
                        <div className="comment-meta">{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              <footer className="action-bar">
                <div className="quick-actions">
                  <button className="icon-btn" type="button" disabled={state.busy} onClick={() => void toggleLike()}><Icon name="heart" size={28} filled={!!state.isLiked} /><b>{video.likes_count}</b></button>
                  <button className="icon-btn" type="button"><Icon name="message" size={28} /><b>{comments.list.length}</b></button>
                  <button className="icon-btn" type="button" onClick={() => void share()}><Icon name="share" size={28} /><b>分享</b></button>
                </div>
              </footer>
            </aside>
          </div>
        ) : null}
      </div>
    </AppShell>
  )
}
