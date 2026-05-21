package worker

import (
	"context"
	"encoding/json"
	"errors"
	"feedsystem_video_go/internal/middleware/rabbitmq"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/notification"
	"log"

	amqp "github.com/rabbitmq/amqp091-go"
	"gorm.io/gorm"
)

type NotificationWorker struct {
	ch    *amqp.Channel
	db    *gorm.DB
	cache *rediscache.Client
	queue string
	hub   NotificationHub
}

type NotificationHub interface {
	Push(userID uint, n *notification.Notification)
}

func NewNotificationWorker(ch *amqp.Channel, db *gorm.DB, cache *rediscache.Client, queue string, hub NotificationHub) *NotificationWorker {
	return &NotificationWorker{ch: ch, db: db, cache: cache, queue: queue, hub: hub}
}

func (w *NotificationWorker) Run(ctx context.Context) error {
	if w == nil || w.ch == nil || w.db == nil {
		return errors.New("notification worker is not initialized")
	}
	if err := w.db.WithContext(ctx).AutoMigrate(&notification.Notification{}); err != nil {
		return err
	}
	deliveries, err := w.ch.Consume(w.queue, "", false, false, false, false, nil)
	if err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				return errors.New("deliveries channel closed")
			}
			w.handleDelivery(ctx, d)
		}
	}
}

func (w *NotificationWorker) handleDelivery(ctx context.Context, d amqp.Delivery) {
	retryCount := rabbitmq.GetRetryCount(d)
	if err := w.process(ctx, d); err != nil {
		if retryCount >= rabbitmq.MaxRetryCount {
			log.Printf("notification worker: max retries, dropping: %v", err)
			_ = d.Ack(false)
			return
		}
		log.Printf("notification worker: failed (retry %d/%d): %v", retryCount+1, rabbitmq.MaxRetryCount, err)
		_ = d.Nack(false, true)
		return
	}
	_ = d.Ack(false)
}

func (w *NotificationWorker) process(ctx context.Context, d amqp.Delivery) error {
	body := d.Body
	if len(body) == 0 {
		return nil
	}
	routingKey := d.RoutingKey

	var notif *notification.Notification

	switch {
	case routingKey == "like.like":
		var evt rabbitmq.LikeEvent
		if err := json.Unmarshal(body, &evt); err != nil {
			return nil
		}
		if evt.UserID == 0 || evt.VideoID == 0 {
			return nil
		}
		var authorID uint
		w.db.WithContext(ctx).Model(&struct {
			ID       uint
			AuthorID uint
		}{}).Table("videos").Where("id = ?", evt.VideoID).Select("author_id").Scan(&authorID)
		if authorID == 0 || authorID == evt.UserID {
			return nil
		}
		notif = &notification.Notification{RecipientID: authorID, SenderID: evt.UserID, Type: notification.TypeLike, TargetID: evt.VideoID, Content: "点赞了你的视频"}

	case routingKey == "comment.publish":
		var evt rabbitmq.CommentEvent
		if err := json.Unmarshal(body, &evt); err != nil {
			return nil
		}
		if evt.AuthorID == 0 || evt.VideoID == 0 {
			return nil
		}
		var authorID uint
		w.db.WithContext(ctx).Model(&struct {
			ID       uint
			AuthorID uint
		}{}).Table("videos").Where("id = ?", evt.VideoID).Select("author_id").Scan(&authorID)
		if authorID == 0 || authorID == evt.AuthorID {
			return nil
		}
		notif = &notification.Notification{RecipientID: authorID, SenderID: evt.AuthorID, Type: notification.TypeComment, TargetID: evt.VideoID, Content: "评论了你的视频"}

	case routingKey == "social.follow":
		var evt rabbitmq.SocialEvent
		if err := json.Unmarshal(body, &evt); err != nil {
			return nil
		}
		if evt.FollowerID == 0 || evt.VloggerID == 0 {
			return nil
		}
		notif = &notification.Notification{RecipientID: evt.VloggerID, SenderID: evt.FollowerID, Type: notification.TypeFollow, TargetID: evt.FollowerID, Content: "关注了你"}
	}

	if notif == nil {
		return nil
	}
	if err := w.db.WithContext(ctx).Create(notif).Error; err != nil {
		return err
	}
	if notification.SupportsUnreadCount(notif.Type) {
		cacheCtx, cancel := context.WithTimeout(context.Background(), notification.CacheOpTimeout)
		defer cancel()
		if _, err := notification.IncrementUnread(cacheCtx, w.cache, notif.RecipientID, 1); err != nil {
			log.Printf("notification worker: unread increment skipped recipient=%d: %v", notif.RecipientID, err)
		}
	}
	if w.hub != nil {
		w.hub.Push(notif.RecipientID, notif)
	}
	return nil
}
