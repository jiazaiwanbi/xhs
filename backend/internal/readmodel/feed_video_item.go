package readmodel

import (
	"context"
	"encoding/json"
	"time"

	rediscache "feedsystem_video_go/internal/middleware/redis"
)

const FeedVideoItemTTL = time.Hour

type FeedAuthor struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
}

type FeedVideoItem struct {
	ID               uint       `json:"id"`
	Author           FeedAuthor `json:"author"`
	Title            string     `json:"title"`
	Description      string     `json:"description,omitempty"`
	PlayURL          string     `json:"play_url"`
	CoverURL         string     `json:"cover_url"`
	CreateTime       int64      `json:"create_time"`
	LikesCount       int64      `json:"likes_count"`
	IsLiked          bool       `json:"is_liked"`
	Popularity       int64      `json:"popularity,omitempty"`
	SortCreateTimeMS int64      `json:"sort_create_time_ms,omitempty"`
}

func FeedVideoItemKey(cache *rediscache.Client, id uint) string {
	return cache.Key("feed:item:%d", id)
}

func NewFeedVideoItem(id uint, authorID uint, username string, title string, description string, playURL string, coverURL string, createTime time.Time, likesCount int64, popularity int64) FeedVideoItem {
	return FeedVideoItem{
		ID:               id,
		Author:           FeedAuthor{ID: authorID, Username: username},
		Title:            title,
		Description:      description,
		PlayURL:          playURL,
		CoverURL:         coverURL,
		CreateTime:       createTime.Unix(),
		LikesCount:       likesCount,
		IsLiked:          false,
		Popularity:       popularity,
		SortCreateTimeMS: createTime.UnixMilli(),
	}
}

func SaveFeedVideoItem(ctx context.Context, cache *rediscache.Client, item FeedVideoItem, ttl time.Duration) error {
	if cache == nil || item.ID == 0 {
		return nil
	}
	if ttl <= 0 {
		ttl = FeedVideoItemTTL
	}
	b, err := json.Marshal(item)
	if err != nil {
		return err
	}
	return cache.SetBytes(ctx, FeedVideoItemKey(cache, item.ID), b, ttl)
}

func DeleteFeedVideoItem(ctx context.Context, cache *rediscache.Client, id uint) error {
	if cache == nil || id == 0 {
		return nil
	}
	return cache.Del(ctx, FeedVideoItemKey(cache, id))
}

func SetFeedVideoLikesCount(ctx context.Context, cache *rediscache.Client, id uint, likesCount int64) error {
	if cache == nil || id == 0 {
		return nil
	}
	item, ok, err := LoadFeedVideoItem(ctx, cache, id)
	if err != nil || !ok {
		return err
	}
	if likesCount < 0 {
		likesCount = 0
	}
	item.LikesCount = likesCount
	return SaveFeedVideoItem(ctx, cache, item, FeedVideoItemTTL)
}

func ChangeFeedVideoLikesCount(ctx context.Context, cache *rediscache.Client, id uint, delta int64) error {
	if cache == nil || id == 0 {
		return nil
	}
	item, ok, err := LoadFeedVideoItem(ctx, cache, id)
	if err != nil || !ok {
		return err
	}
	item.LikesCount += delta
	if item.LikesCount < 0 {
		item.LikesCount = 0
	}
	return SaveFeedVideoItem(ctx, cache, item, FeedVideoItemTTL)
}

func LoadFeedVideoItem(ctx context.Context, cache *rediscache.Client, id uint) (FeedVideoItem, bool, error) {
	if cache == nil || id == 0 {
		return FeedVideoItem{}, false, nil
	}
	b, err := cache.GetBytes(ctx, FeedVideoItemKey(cache, id))
	if err != nil {
		return FeedVideoItem{}, false, err
	}
	var item FeedVideoItem
	if err := json.Unmarshal(b, &item); err != nil {
		return FeedVideoItem{}, false, err
	}
	return item, true, nil
}
