package video

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"feedsystem_video_go/internal/apierror"
	"feedsystem_video_go/internal/middleware/rabbitmq"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/notification"
	"feedsystem_video_go/internal/readmodel"

	localcache "github.com/patrickmn/go-cache"
	"gorm.io/gorm"
)

type NotificationPusher interface {
	Push(userID uint, n *notification.Notification)
}

type VideoService struct {
	repo         *VideoRepository
	cache        *rediscache.Client
	localcache   *localcache.Cache
	cacheTTL     time.Duration
	popularityMQ *rabbitmq.PopularityMQ
	notifier     NotificationPusher
}

func NewVideoService(repo *VideoRepository, cache *rediscache.Client, popularityMQ *rabbitmq.PopularityMQ, notifier NotificationPusher) *VideoService {
	return &VideoService{repo: repo, cache: cache, localcache: localcache.New(3*time.Second, 5*time.Second), cacheTTL: 5 * time.Minute, popularityMQ: popularityMQ, notifier: notifier}
}

func (vs *VideoService) Publish(ctx context.Context, video *Video, notifyFollowers bool) error {
	if video == nil {
		return errors.New("video is nil")
	}
	video.Title = strings.TrimSpace(video.Title)
	video.PlayURL = strings.TrimSpace(video.PlayURL)
	video.CoverURL = strings.TrimSpace(video.CoverURL)

	if video.Title == "" {
		return errors.New("title is required")
	}
	if video.PlayURL == "" {
		return errors.New("play url is required")
	}
	if video.CoverURL == "" {
		return errors.New("cover url is required")
	}

	var pushedNotifications []notification.Notification

	//事务保证视频写入库和消息写入本地消息表的一致性
	err := vs.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(video).Error; err != nil {
			return err
		}

		msg := OutboxMsg{
			VideoID:    video.ID,
			EventType:  "video_published",
			Status:     "pending",
			CreateTime: video.CreateTime,
		}

		if err := tx.Create(&msg).Error; err != nil {
			return err
		}

		tags := ExtractTags(video.Title + " " + video.Description)
		for _, tagName := range tags {
			var tag Tag
			tx.Where("name = ?", tagName).FirstOrCreate(&tag, Tag{Name: tagName})
			tx.Create(&VideoTag{VideoID: video.ID, TagID: tag.ID})
		}

		if !notifyFollowers {
			return nil
		}

		var followerCount int64
		if err := tx.Table("socials").Where("vlogger_id = ?", video.AuthorID).Count(&followerCount).Error; err != nil {
			return err
		}
		if followerCount == 0 {
			return nil
		}

		content := buildPublishNotificationContent(video.Title)
		if followerCount > 1000 {
			return tx.Create(&notification.Broadcast{
				AuthorID:  video.AuthorID,
				VideoID:   video.ID,
				Content:   content,
				CreatedAt: video.CreateTime,
			}).Error
		}

		var followerIDs []uint
		if err := tx.Table("socials").Where("vlogger_id = ?", video.AuthorID).Order("follower_id ASC").Pluck("follower_id", &followerIDs).Error; err != nil {
			return err
		}
		if len(followerIDs) == 0 {
			return nil
		}

		pushedNotifications = make([]notification.Notification, 0, len(followerIDs))
		for _, followerID := range followerIDs {
			pushedNotifications = append(pushedNotifications, notification.Notification{
				RecipientID: followerID,
				SenderID:    video.AuthorID,
				Type:        notification.TypePublish,
				TargetID:    video.ID,
				Content:     content,
				CreatedAt:   video.CreateTime,
			})
		}
		return tx.Create(&pushedNotifications).Error
	})
	if err == nil {
		vs.saveFeedReadModel(ctx, video)
		vs.pushPublishNotifications(pushedNotifications)
	}
	return err

}

func (vs *VideoService) Delete(ctx context.Context, id uint, authorID uint) error {
	video, err := vs.repo.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if video == nil {
		return errors.New("video not found")
	}
	if video.AuthorID != authorID {
		return apierror.ErrUnauthorized
	}
	if err := vs.repo.DeleteVideo(ctx, id); err != nil {
		return err
	}
	vs.delLocalDetail(id)
	vs.deleteFeedReadModel(id)
	if vs.cache != nil {
		cacheKey := vs.cache.Key("video:detail:id=%d", id)
		_ = vs.cache.Del(context.Background(), cacheKey)
	}
	return nil
}

func (vs *VideoService) ListByAuthorID(ctx context.Context, authorID uint) ([]Video, error) {
	videos, err := vs.repo.ListByAuthorID(ctx, int64(authorID))
	if err != nil {
		return nil, err
	}
	return videos, nil
}

func (vs *VideoService) GetDetail(ctx context.Context, id uint) (*Video, error) {
	cacheKey := vs.cache.Key("video:detail:id=%d", id)
	if vs.localcache != nil {
		if v, found := vs.localcache.Get(cacheKey); found {
			if cached, ok := v.(Video); ok {
				return &cached, nil
			}
		}
	}

	getCached := func() (*Video, bool) {
		opCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		defer cancel()

		b, err := vs.cache.GetBytes(opCtx, cacheKey)
		if err != nil {
			return nil, false
		}
		var cached Video
		if err := json.Unmarshal(b, &cached); err != nil {
			return nil, false
		}
		vs.setLocalDetail(cacheKey, &cached)
		return &cached, true
	}

	setCached := func(video *Video) {
		vs.setLocalDetail(cacheKey, video)
		b, err := json.Marshal(video)
		if err != nil {
			return
		}
		opCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		defer cancel()
		_ = vs.cache.SetBytes(opCtx, cacheKey, b, vs.cacheTTL)
	}

	if vs.cache != nil {
		if v, ok := getCached(); ok {
			return v, nil
		}

		opCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		b, err := vs.cache.GetBytes(opCtx, cacheKey)
		cancel()
		if err == nil {
			var cached Video
			if err := json.Unmarshal(b, &cached); err == nil {
				return &cached, nil
			}
		} else if rediscache.IsMiss(err) {
			lockKey := "lock:" + cacheKey

			lockCtx, lockCancel := context.WithTimeout(ctx, 50*time.Millisecond)
			token, locked, lockErr := vs.cache.Lock(lockCtx, lockKey, 2*time.Second)
			lockCancel()

			if lockErr == nil && locked {
				defer func() { _ = vs.cache.Unlock(context.Background(), lockKey, token) }()

				if v, ok := getCached(); ok {
					return v, nil
				}

				video, err := vs.repo.GetByID(ctx, id)
				if err != nil {
					return nil, err
				}
				setCached(video)
				return video, nil
			}

			// 没拿到锁：等待别人回填缓存
			for i := 0; i < 5; i++ {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(20 * time.Millisecond):
				}
				if v, ok := getCached(); ok {
					return v, nil
				}
			}
		}
	}

	video, err := vs.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if vs.cache != nil {
		setCached(video)
	}
	return video, nil
}

func (vs *VideoService) UpdateLikesCount(ctx context.Context, id uint, likesCount int64) error {
	if err := vs.repo.UpdateLikesCount(ctx, id, likesCount); err != nil {
		return err
	}
	vs.delLocalDetail(id)
	vs.setFeedReadModelLikesCount(ctx, id, likesCount)
	if vs.cache != nil {
		_ = vs.cache.Del(context.Background(), vs.cache.Key("video:detail:id=%d", id))
	}
	return nil
}

func (vs *VideoService) UpdatePopularity(ctx context.Context, id uint, change int64) error {
	if err := vs.repo.UpdatePopularity(ctx, id, change); err != nil {
		return err
	}
	vs.invalidateDetail(id)

	if vs.popularityMQ != nil {
		if err := vs.popularityMQ.Update(ctx, id, change); err == nil {
			return nil
		}
	}

	if vs.cache != nil {
		// 1) 详情缓存：直接失效（最简单靠谱）
		vs.invalidateDetail(id)

		// 2) 热榜：写到“时间窗ZSET”，不要用 detail key
		now := time.Now().UTC().Truncate(time.Minute)
		windowKey := vs.cache.Key("hot:video:1m:%s", now.Format("200601021504"))
		member := strconv.FormatUint(uint64(id), 10)

		opCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		defer cancel()

		_ = vs.cache.ZincrBy(opCtx, windowKey, member, float64(change))
		_ = vs.cache.Expire(opCtx, windowKey, 2*time.Hour)
	}
	return nil
}

func (vs *VideoService) setLocalDetail(cacheKey string, video *Video) {
	if vs.localcache == nil || video == nil {
		return
	}
	vs.localcache.Set(cacheKey, *video, 3*time.Second)
}

func (vs *VideoService) delLocalDetail(id uint) {
	if vs.localcache == nil {
		return
	}
	vs.localcache.Delete(vs.cache.Key("video:detail:id=%d", id))
}

func (vs *VideoService) invalidateDetail(id uint) {
	vs.delLocalDetail(id)
	if vs.cache != nil {
		_ = vs.cache.Del(context.Background(), vs.cache.Key("video:detail:id=%d", id))
	}
}

func (vs *VideoService) saveFeedReadModel(ctx context.Context, v *Video) {
	if vs.cache == nil || v == nil {
		return
	}
	cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	item := readmodel.NewFeedVideoItem(v.ID, v.AuthorID, v.Username, v.Title, v.Description, v.PlayURL, v.CoverURL, v.CreateTime, v.LikesCount, v.Popularity)
	_ = readmodel.SaveFeedVideoItem(cacheCtx, vs.cache, item, readmodel.FeedVideoItemTTL)
}

func (vs *VideoService) deleteFeedReadModel(id uint) {
	if vs.cache == nil || id == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_ = readmodel.DeleteFeedVideoItem(ctx, vs.cache, id)
}

func (vs *VideoService) setFeedReadModelLikesCount(ctx context.Context, id uint, likesCount int64) {
	if vs.cache == nil || id == 0 {
		return
	}
	cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	_ = readmodel.SetFeedVideoLikesCount(cacheCtx, vs.cache, id, likesCount)
}

func (vs *VideoService) pushPublishNotifications(items []notification.Notification) {
	if len(items) == 0 {
		return
	}
	for i := range items {
		cacheCtx, cancel := context.WithTimeout(context.Background(), notification.CacheOpTimeout)
		_, _ = notification.IncrementUnread(cacheCtx, vs.cache, items[i].RecipientID, 1)
		cancel()
		if vs.notifier != nil {
			copyItem := items[i]
			vs.notifier.Push(copyItem.RecipientID, &copyItem)
		}
	}
}

func buildPublishNotificationContent(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "发布了新笔记"
	}
	runes := []rune(title)
	if len(runes) > 60 {
		title = string(runes[:60]) + "..."
	}
	return "发布了新笔记：" + title
}
