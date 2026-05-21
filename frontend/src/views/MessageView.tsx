import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../api/client'
import * as accountApi from '../api/account'
import * as messageApi from '../api/message'
import type { Account, DirectMessage, NotificationItem } from '../api/types'
import AppShell from '../components/AppShell'
import UserAvatar from '../components/UserAvatar'
import { useAuth } from '../stores/auth'
import { useNotification } from '../stores/notification'
import { useSocial } from '../stores/social'
import { useToast } from '../stores/toast'

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export default function MessageView() {
  const { threadId: rawThreadId } = useParams()
  const navigate = useNavigate()
  const auth = useAuth()
  const notifications = useNotification()
  const social = useSocial()
  const toast = useToast()
  const listEl = useRef<HTMLDivElement>(null)
  const inboxBootstrapped = useRef(false)
  const myId = auth.claims?.account_id ?? 0
  const threadId = rawThreadId ?? ''
  const isLikesThread = threadId === 'likes'
  const isRepliesThread = threadId === 'replies'
  const isNotificationThread = isLikesThread || isRepliesThread
  const peerId = isNotificationThread || !threadId ? 0 : Number(threadId)
  const hasPeer = Number.isFinite(peerId) && peerId > 0
  const hasSelection = isNotificationThread || hasPeer
  const [content, setContent] = useState('')
  const [state, setState] = useState({ loading: false, sending: false, error: '', peer: null as Account | null, messages: [] as DirectMessage[] })
  const [senderMap, setSenderMap] = useState<Record<number, Account>>({})

  const orderedMessages = useMemo(() => [...state.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()), [state.messages])
  const dynamicItems = useMemo(
    () => [
      { key: 'likes', label: '收到的赞', subtitle: '别人赞了你的内容', unread: notifications.likes.filter((item) => !item.is_read).length },
      { key: 'replies', label: '新回复', subtitle: '评论、提及和关注动态', unread: notifications.replies.filter((item) => !item.is_read).length },
    ],
    [notifications.likes, notifications.replies],
  )
  const activeNotifications = useMemo<NotificationItem[]>(
    () => (isLikesThread ? notifications.likes : isRepliesThread ? notifications.replies : []),
    [isLikesThread, isRepliesThread, notifications.likes, notifications.replies],
  )
  const messageUnreadCountBySender = useMemo(() => {
    const counts = new Map<number, number>()
    for (const item of notifications.messages) {
      if (item.is_read) continue
      counts.set(item.sender_id, (counts.get(item.sender_id) ?? 0) + 1)
    }
    return counts
  }, [notifications.messages])
  const contactItems = useMemo(() => {
    const map = new Map<number, Account>()
    for (const user of social.vloggers) map.set(user.id, user)
    for (const user of social.followers) map.set(user.id, user)
    for (const item of notifications.messages) {
      const sender = senderMap[item.sender_id]
      if (sender) map.set(sender.id, sender)
    }
    return [...map.values()]
  }, [notifications.messages, senderMap, social.followers, social.vloggers])

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

  function mergeMessages(current: DirectMessage[], next: DirectMessage) {
    const deduped = current.filter((item) => item.id !== next.id)
    return [next, ...deduped]
  }

  async function refreshInbox() {
    await Promise.all([social.refreshMine(), notifications.refresh()])
  }

  async function loadChat(silent = false) {
    if (!hasPeer) {
      setState({ loading: false, sending: false, error: '', peer: null, messages: [] })
      return
    }
    if (!silent) setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [peer, res] = await Promise.all([accountApi.findById(peerId), messageApi.listMessages(peerId)])
      setState((s) => ({ ...s, loading: false, error: '', peer, messages: res.messages ?? [] }))
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
      setState((s) => ({ ...s, sending: false, messages: mergeMessages(s.messages, msg) }))
      setContent('')
      scrollToBottom()
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e))
      setState((s) => ({ ...s, sending: false }))
    }
  }

  useEffect(() => {
    if (!auth.isLoggedIn || inboxBootstrapped.current) return
    inboxBootstrapped.current = true
    void refreshInbox()
  }, [auth.isLoggedIn])

  useEffect(() => {
    if (!isNotificationThread) return
    void notifications.markCategoryRead(isLikesThread ? 'likes' : 'replies')
  }, [isLikesThread, isNotificationThread, notifications, isRepliesThread])

  useEffect(() => {
    const ids = [...new Set([...activeNotifications, ...notifications.messages].map((item) => item.sender_id).filter((id) => id > 0 && !senderMap[id]))]
    if (ids.length === 0) return
    let cancelled = false
    void Promise.all(ids.map((id) => accountApi.findById(id).then((account) => [id, account] as const).catch(() => null))).then((items) => {
      if (cancelled) return
      const next: Record<number, Account> = {}
      for (const item of items) {
        if (!item) continue
        next[item[0]] = item[1]
      }
      if (Object.keys(next).length > 0) {
        setSenderMap((current) => ({ ...current, ...next }))
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeNotifications, notifications.messages, senderMap])

  useEffect(() => {
    setContent('')
    if (hasPeer) {
      setState((s) => ({ ...s, peer: null, messages: [] }))
      void loadChat()
      return
    }
    setState({ loading: false, sending: false, error: '', peer: null, messages: [] })
  }, [threadId])

  useEffect(() => {
    if (!hasPeer) return
    void notifications.markThreadRead(peerId)
    if (!auth.token) return
    const stream = new EventSource(`${API_BASE}/message/stream?token=${encodeURIComponent(auth.token)}`)
    stream.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as DirectMessage
        const isForActiveThread =
          (next.from_id === peerId && next.to_id === myId) ||
          (next.from_id === myId && next.to_id === peerId)
        if (!isForActiveThread) return
        setState((current) => ({ ...current, messages: mergeMessages(current.messages, next) }))
        if (next.from_id === peerId) {
          void notifications.markThreadRead(peerId)
        }
        scrollToBottom()
      } catch {
        // Ignore malformed SSE payloads.
      }
    }
    return () => {
      stream.close()
    }
  }, [auth.token, hasPeer, myId, notifications, peerId])

  const contactLoading = social.vloggersLoading || social.followersLoading
  const contactError = social.vloggersError || social.followersError || notifications.error
  const canSend = content.trim().length > 0 && !state.sending && !!state.peer && peerId > 0

  function formatNotificationTitle(item: NotificationItem) {
    if (item.type === 'like') return '赞了你的内容'
    if (item.type === 'publish') return '发布了新笔记'
    if (item.type === 'mention') return '在评论里提到了你'
    return '回复了你'
  }

  return (
    <AppShell>
      <section className={`chat-shell ${hasSelection ? 'has-selection' : ''}`}>
        <aside className="contact-panel">
          <div className="contact-head">
            <div><p className="title">消息中心</p><p className="subtle">动态和私信放到一起看。</p></div>
            <button className="ghost small" type="button" disabled={contactLoading} onClick={() => void refreshInbox()}>刷新</button>
          </div>
          <div className="contact-body">
            <div className="contact-group">
              <div className="contact-group-title">动态</div>
              {dynamicItems.map((item) => (
                <button key={item.key} className={`contact-row ${threadId === item.key ? 'active' : ''}`} type="button" onClick={() => void navigate(`/messages/${item.key}`)}>
                  <span className={`inbox-icon ${item.key}`}>{item.key === 'likes' ? '赞' : '评'}</span>
                  <span className="contact-meta"><span className="contact-name">{item.label}</span><span className="contact-id">{item.subtitle}</span></span>
                  <span className="contact-side">
                    {item.unread > 0 ? <b className="count-badge">{item.unread > 99 ? '99+' : item.unread}</b> : null}
                    <span className="contact-action">查看</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="contact-group">
              <div className="contact-group-title">私信用户</div>
              {contactLoading ? <div className="chat-hint">加载中...</div> : null}
              {contactError ? <div className="chat-hint bad">{contactError}</div> : null}
              {!contactLoading && !contactError && contactItems.length === 0 ? <div className="empty"><div className="empty-title">暂无可聊天用户</div><div className="empty-text">关注别人或拥有粉丝后，可以从这里开始私信。</div></div> : null}
              {contactItems.map((user) => (
                <button key={user.id} className={`contact-row ${peerId === user.id ? 'active' : ''}`} type="button" onClick={() => void navigate(`/messages/${user.id}`)}>
                  <UserAvatar username={user.username} id={user.id} size={42} />
                  <span className="contact-meta"><span className="contact-name">@{user.username}</span><span className="contact-id mono">#{user.id}</span></span>
                  <span className="contact-side">
                    {(messageUnreadCountBySender.get(user.id) ?? 0) > 0 ? <b className="count-badge">{messageUnreadCountBySender.get(user.id)! > 99 ? '99+' : messageUnreadCountBySender.get(user.id)}</b> : null}
                    <span className="contact-action">聊天</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="chat-panel">
          {isNotificationThread ? (
            <>
              <header className="chat-head">
                <button className="icon-btn" type="button" title="返回" onClick={() => void navigate('/messages')}>‹</button>
                <div className="peer">
                  <span className={`inbox-icon large ${isLikesThread ? 'likes' : 'replies'}`}>{isLikesThread ? '赞' : '评'}</span>
                  <span className="peer-meta"><span className="peer-name">{isLikesThread ? '收到的赞' : '新回复'}</span><span className="peer-id">{isLikesThread ? '看看谁给你点赞了' : '评论、提及和关注动态都会显示在这里'}</span></span>
                </div>
                <button className="ghost small" type="button" disabled={notifications.loading} onClick={() => void notifications.refresh()}>刷新</button>
              </header>
              <div className="message-list notice-list">
                {notifications.loading ? <div className="chat-hint">加载中...</div> : null}
                {!notifications.loading && activeNotifications.length === 0 ? <div className="empty"><div className="empty-title">暂时没有新动态</div><div className="empty-text">有人点赞或回复后，会第一时间出现在这里。</div></div> : null}
                {activeNotifications.map((item) => {
                  const sender = senderMap[item.sender_id]
                  return (
                    <article key={item.id} className={`notice-card ${item.is_read ? '' : 'unread'}`}>
                      <button className="notice-main" type="button" onClick={() => void navigate(item.target_id ? `/video/${item.target_id}` : '/messages')}>
                        <UserAvatar username={sender?.username ?? `U${item.sender_id}`} id={sender?.id ?? item.sender_id} size={42} />
                        <span className="notice-copy">
                          <span className="notice-title">@{sender?.username ?? `用户${item.sender_id}`} {formatNotificationTitle(item)}</span>
                          <span className="notice-text">{item.content}</span>
                          <span className="notice-time">{formatTime(item.created_at)}</span>
                        </span>
                      </button>
                    </article>
                  )
                })}
              </div>
            </>
          ) : hasPeer ? (
            <>
              <header className="chat-head">
                <button className="icon-btn" type="button" title="返回" onClick={() => void navigate('/messages')}>‹</button>
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
            </>
          ) : (
            <>
              <header className="chat-head single">
                <div>
                  <p className="title">消息中心</p>
                  <p className="subtle">左边查看动态，或者选择一个联系人开始私信。</p>
                </div>
                <button className="ghost small" type="button" disabled={contactLoading} onClick={() => void refreshInbox()}>刷新</button>
              </header>
              <div className="message-list">
                <div className="empty">
                  <div className="empty-title">先选一项消息</div>
                  <div className="empty-text">收到的赞、新回复和私信都会在这里统一展示。</div>
                </div>
              </div>
            </>
          )}
        </section>
      </section>
    </AppShell>
  )
}
