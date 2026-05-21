package notification

import (
	"context"
	"time"

	rediscache "feedsystem_video_go/internal/middleware/redis"
)

func UnreadKey(cache *rediscache.Client, userID uint) string {
	if cache == nil || userID == 0 {
		return ""
	}
	return cache.Key("notification:unread:%d", userID)
}

func IncrementUnread(ctx context.Context, cache *rediscache.Client, userID uint, delta int64) (int64, error) {
	if cache == nil || userID == 0 || delta == 0 {
		return 0, nil
	}
	return cache.IncrBy(ctx, UnreadKey(cache, userID), delta)
}

func SetUnread(ctx context.Context, cache *rediscache.Client, userID uint, count int64) error {
	if cache == nil || userID == 0 {
		return nil
	}
	if count < 0 {
		count = 0
	}
	return cache.SetInt64(ctx, UnreadKey(cache, userID), count, 0)
}

func GetUnread(ctx context.Context, cache *rediscache.Client, userID uint) (int64, error) {
	if cache == nil || userID == 0 {
		return 0, nil
	}
	return cache.GetInt64(ctx, UnreadKey(cache, userID))
}

func ClampUnreadNonNegative(ctx context.Context, cache *rediscache.Client, userID uint) error {
	if cache == nil || userID == 0 {
		return nil
	}
	value, err := cache.GetInt64(ctx, UnreadKey(cache, userID))
	if err != nil {
		return err
	}
	if value >= 0 {
		return nil
	}
	return cache.SetInt64(ctx, UnreadKey(cache, userID), 0, 0)
}

const CacheOpTimeout = 50 * time.Millisecond
