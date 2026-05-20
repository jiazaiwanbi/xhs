import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import * as messageApi from '../api/message'
import type { Account, DirectMessage } from '../api/types'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

export default function MessageView() {
  const { peerId: rawPeerId } = useParams()
  const peerId = rawPeerId ? Number(rawPeerId) : 0
  const hasPeer = Number.isFinite(peerId) && peerId > 0
  const navigate = useNavigate()
  const auth = useAuth()
  const social = useSocial()
  const toast = useToast()
  const listEl = useRef<HTMLDivElement>(null)
  const myId = auth.claims?.account_id ?? 0
  const [content, setContent] = useState('')
  const [state, setState] = useState({ loading: false, sending: false, error: '', peer: null as Account | null, messages: [] as DirectMessage[] })

  const orderedMessages = useMemo(() => [...state.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [state.messages])
  const contactItems = useMemo(() => {
    const map = new Map<number, Account>()
    for (const user of social.vloggers) map.set(user.id, user)
    for (const user of social.followers) map.set(user.id, user)
    return [...map.values()].filter((user) => user.id !== myId)
  }, [myId, social.followers, social.vloggers])

  function formatTime(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  function scrollToBottom() {
    window.requestAnimationFrame(() => {
      if (listEl.current) listEl.current.scrollTop = listEl.current.scrollHeight
    })
  }

  async function loadChat() {
    if (!hasPeer) {
      await social.refreshMine()
      setState({ loading: false, sending: false, error: '', peer: null, messages: [] })
      return
    }
    if (peerId === myId) return setState((s) => ({ ...s, error: '请选择其他用户发送私信' }))
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [peer, res] = await Promise.all([accountApi.findById(peerId), messageApi.listMessages(peerId)])
      setState((s) => ({ ...s, loading: false, peer, messages: res.messages ?? [] }))
      scrollToBottom()
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof ApiError ? e.message : String(e), peer: null, messages: [] }))
    }
  }

  async function send() {
    const text = content.trim()
    if (!text || state.sending || !state.peer) return
    setState((s) => ({ ...s, sending: true }))
    try {
      const msg = await messageApi.sendMessage(peerId, text)
      setState((s) => ({ ...s, sending: false, messages: [msg, ...s.messages] }))
      setContent('')
      scrollToBottom()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
      setState((s) => ({ ...s, sending: false }))
    }
  }

  useEffect(() => {
    setState((s) => ({ ...s, peer: null, messages: [] }))
    setContent('')
    void loadChat()
  }, [rawPeerId])

  const contactLoading = social.vloggersLoading || social.followersLoading
  const contactError = social.vloggersError || social.followersError
  const canSend = content.trim().length > 0 && !state.sending && !!state.peer && peerId > 0

  return (
    <AppShell>
      <section className="chat-shell">
        {!hasPeer ? (
          <div className="contact-panel">
            <div className="contact-head">
              <div><p className="title">私信</p><p className="subtle">选择关注或粉丝里的用户开始聊天。</p></div>
              <button className="ghost small" type="button" disabled={contactLoading} onClick={() => void social.refreshMine()}>刷新</button>
            </div>
            <div className="contact-body">
              {contactLoading ? <div className="chat-hint">加载中...</div> : null}
              {contactError ? <div className="chat-hint bad">{contactError}</div> : null}
              {!contactLoading && !contactError && contactItems.length === 0 ? <div className="empty"><div className="empty-title">暂无可聊天用户</div><div className="empty-text">关注别人或拥有粉丝后，可以从这里开始私信。</div></div> : null}
              {contactItems.map((user) => (
                <button key={user.id} className="contact-row" type="button" onClick={() => void navigate(`/messages/${user.id}`)}>
                  <UserAvatar username={user.username} id={user.id} size={42} />
                  <span className="contact-meta"><span className="contact-name">@{user.username}</span><span className="contact-id mono">#{user.id}</span></span>
                  <span className="contact-action">聊天</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-panel">
            <header className="chat-head">
              <button className="icon-btn" type="button" title="返回" onClick={() => navigate(-1)}>‹</button>
              <button className="peer" type="button" disabled={!state.peer} onClick={() => state.peer && void navigate(`/u/${state.peer.id}`)}>
                <UserAvatar username={state.peer?.username ?? 'User'} id={state.peer?.id ?? peerId} size={44} />
                <span className="peer-meta"><span className="peer-name">@{state.peer?.username ?? '加载中'}</span><span className="peer-id mono">#{state.peer?.id ?? peerId}</span></span>
              </button>
              <button className="ghost small" type="button" disabled={state.loading} onClick={() => void loadChat()}>刷新</button>
            </header>
            <div ref={listEl} className="message-list">
              {state.loading ? <div className="chat-hint">加载中...</div> : null}
              {state.error ? <div className="chat-hint bad">{state.error}</div> : null}
              {!state.loading && !state.error && orderedMessages.length === 0 ? <div className="empty"><div className="empty-title">开始聊天</div><div className="empty-text">给 @{state.peer?.username ?? '对方'} 发第一条消息。</div></div> : null}
              {orderedMessages.map((msg) => (
                <div key={msg.id} className={`bubble-row ${msg.from_id === myId ? 'mine' : ''}`}>
                  {msg.from_id !== myId ? <UserAvatar username={state.peer?.username ?? 'User'} id={state.peer?.id ?? msg.from_id} size={32} /> : null}
                  <div className="bubble-wrap"><div className="bubble">{msg.content}</div><div className="bubble-time">{formatTime(msg.created_at)}</div></div>
                </div>
              ))}
            </div>
            <footer className="composer">
              <textarea value={content} placeholder="输入私信内容" disabled={!!state.error || state.loading || state.sending} onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} />
              <button className="primary send-btn" type="button" disabled={!canSend} onClick={() => void send()}>{state.sending ? '发送中' : '发送'}</button>
            </footer>
          </div>
        )}
      </section>
    </AppShell>
  )
}
