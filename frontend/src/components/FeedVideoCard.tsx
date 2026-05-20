import { Link } from 'react-router-dom'

import type { FeedVideoItem } from '../api/types'

type Props = {
  item: FeedVideoItem
  canLike: boolean
  busy?: boolean
  onToggleLike: (item: FeedVideoItem) => void
}

export default function FeedVideoCard({ item, canLike, busy, onToggleLike }: Props) {
  return (
    <div className="feed-card">
      <Link className="feed-cover" to={`/video/${item.id}`} aria-label={`查看笔记：${item.title}`}>
        <img src={item.cover_url} alt={item.title} loading="lazy" />
      </Link>
      <div className="feed-content">
        <div className="row spread">
          <div>
            <div className="feed-title">
              <Link to={`/video/${item.id}`}>{item.title}</Link>
            </div>
            <div className="subtle">
              @{item.author.username} · #{item.author.id} · {new Date(item.create_time * 1000).toLocaleString()}
            </div>
          </div>
          <div className="row">
            <span className="pill mono">♥ {item.likes_count}</span>
            {canLike ? (
              <button className="primary" type="button" disabled={busy} onClick={() => onToggleLike(item)} title={item.is_liked ? '取消点赞' : '点赞'}>
                {item.is_liked ? '已赞' : '点赞'}
              </button>
            ) : null}
          </div>
        </div>
        {item.description ? <div className="note-copy clamp">{item.description}</div> : null}
        <div className="row feed-actions">
          <a className="pill mono" href={item.cover_url || item.play_url} target="_blank" rel="noreferrer">
            原图
          </a>
          <Link className="pill" to={`/video/${item.id}`}>
            查看笔记 / 评论
          </Link>
        </div>
      </div>
    </div>
  )
}
