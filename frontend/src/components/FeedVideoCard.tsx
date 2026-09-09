import { Link } from 'react-router-dom'

import type { FeedVideoItem } from '../api/types'
import UserAvatar from './UserAvatar'
import Icon from './Icon'

type Props = {
  item: FeedVideoItem
  canLike: boolean
  busy?: boolean
  onToggleLike: (item: FeedVideoItem) => void
}

export default function FeedVideoCard({ item, canLike, busy, onToggleLike }: Props) {
  return (
    <article className="feed-card">
      <Link className="feed-cover" to={`/video/${item.id}`} aria-label={`查看笔记：${item.title}`}>
        <img src={item.cover_url} alt={item.title} loading="lazy" />
      </Link>
      <div className="feed-content">
        <Link className="feed-title" to={`/video/${item.id}`}>{item.title}</Link>
        <div className="feed-meta">
          <Link className="feed-author" to={`/u/${item.author.id}`}><UserAvatar username={item.author.username} id={item.author.id} size={24} /><span>{item.author.username}</span></Link>
          <button className={`feed-like ${item.is_liked ? 'liked' : ''}`} type="button" disabled={busy} onClick={() => onToggleLike(item)} title={!canLike ? '登录后点赞' : item.is_liked ? '取消点赞' : '点赞'}><Icon name="heart" size={19} filled={item.is_liked} /><span>{item.likes_count}</span></button>
        </div>
      </div>
    </article>
  )
}
