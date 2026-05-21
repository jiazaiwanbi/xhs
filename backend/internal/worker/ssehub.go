package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"sync"
	"time"

	"feedsystem_video_go/internal/auth"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/notification"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SSEHub struct {
	mu      sync.RWMutex
	clients map[uint][]chan *notification.Notification
	db      *gorm.DB
	cache   *rediscache.Client
}

func NewSSEHub(db *gorm.DB, cache *rediscache.Client) *SSEHub {
	return &SSEHub{clients: make(map[uint][]chan *notification.Notification), db: db, cache: cache}
}

func (h *SSEHub) Push(userID uint, n *notification.Notification) {
	h.mu.RLock()
	chs, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok {
		return
	}
	for _, ch := range chs {
		select {
		case ch <- n:
		default:
		}
	}
}

func (h *SSEHub) Subscribe(userID uint) chan *notification.Notification {
	ch := make(chan *notification.Notification, 20)
	h.mu.Lock()
	h.clients[userID] = append(h.clients[userID], ch)
	h.mu.Unlock()
	return ch
}

func (h *SSEHub) Unsubscribe(userID uint, ch chan *notification.Notification) {
	h.mu.Lock()
	defer h.mu.Unlock()
	chs := h.clients[userID]
	for i, c := range chs {
		if c == ch {
			h.clients[userID] = append(chs[:i], chs[i+1:]...)
			close(c)
			return
		}
	}
}

func (h *SSEHub) SSERequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.Query("token")
		if token == "" {
			token = c.GetHeader("Authorization")
			if len(token) > 7 && token[:7] == "Bearer " {
				token = token[7:]
			}
		}
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
			return
		}
		claims, err := auth.ParseToken(token)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}
		c.Set("accountID", claims.AccountID)
		c.Next()
	}
}

func (h *SSEHub) SSEHandler(c *gin.Context) {
	accountID, _ := c.Get("accountID")
	userID := accountID.(uint)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)

	ch := h.Subscribe(userID)
	defer h.Unsubscribe(userID, ch)

	ctx := c.Request.Context()
	flusher, _ := c.Writer.(http.Flusher)

	for {
		select {
		case <-ctx.Done():
			return
		case n, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(n)
			fmt.Fprintf(c.Writer, "data: %s\n\n", b)
			if flusher != nil {
				flusher.Flush()
			}
		case <-time.After(30 * time.Second):
			fmt.Fprintf(c.Writer, ": keepalive\n\n")
			if flusher != nil {
				flusher.Flush()
			}
		}
	}
}

func (h *SSEHub) ListHandler(c *gin.Context) {
	accountID, _ := c.Get("accountID")
	userID := accountID.(uint)

	personal, err := h.listPersonalNotifications(c.Request.Context(), userID, 50)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	broadcasts, err := h.listBroadcastNotifications(c.Request.Context(), userID, 50)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	items := append(personal, broadcasts...)
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	if len(items) > 50 {
		items = items[:50]
	}
	if items == nil {
		items = []notification.Notification{}
	}
	c.JSON(200, gin.H{"notifications": items})
}

func (h *SSEHub) MarkReadHandler(c *gin.Context) {
	accountID, _ := c.Get("accountID")
	userID := accountID.(uint)

	var req struct {
		ID *uint `json:"id"`
	}
	c.ShouldBindJSON(&req)

	var result *gorm.DB
	if req.ID != nil {
		result = h.db.WithContext(c.Request.Context()).
			Model(&notification.Notification{}).
			Where("id = ? AND recipient_id = ? AND is_read = ?", *req.ID, userID, false).
			Update("is_read", true)
	} else {
		result = h.db.WithContext(c.Request.Context()).
			Model(&notification.Notification{}).
			Where("recipient_id = ? AND is_read = ? AND type IN ?", userID, false, supportedNotificationTypes()).
			Update("is_read", true)
	}
	if result != nil && result.Error == nil && result.RowsAffected > 0 {
		cacheCtx, cancel := context.WithTimeout(c.Request.Context(), notification.CacheOpTimeout)
		defer cancel()
		if _, err := notification.IncrementUnread(cacheCtx, h.cache, userID, -result.RowsAffected); err == nil {
			_ = notification.ClampUnreadNonNegative(cacheCtx, h.cache, userID)
		}
	}
	c.JSON(200, gin.H{"message": "ok"})
}

func (h *SSEHub) UnreadCountHandler(c *gin.Context) {
	accountID, _ := c.Get("accountID")
	userID := accountID.(uint)

	cacheCtx, cancel := context.WithTimeout(c.Request.Context(), notification.CacheOpTimeout)
	defer cancel()
	if h.cache != nil {
		if count, err := notification.GetUnread(cacheCtx, h.cache, userID); err == nil {
			c.JSON(200, gin.H{"count": count})
			return
		} else if !rediscache.IsMiss(err) {
			// Fall through to DB recalc on unexpected cache errors.
		}
	}

	var count int64
	h.db.WithContext(c.Request.Context()).
		Model(&notification.Notification{}).
		Where("recipient_id = ? AND is_read = ? AND type IN ?", userID, false, supportedNotificationTypes()).
		Count(&count)
	_ = notification.SetUnread(cacheCtx, h.cache, userID, count)
	c.JSON(200, gin.H{"count": count})
}

func (h *SSEHub) RegisterRoutes(r *gin.Engine, group *gin.RouterGroup) {
	group.GET("/stream", h.SSEHandler)
	group.POST("/list", h.ListHandler)
	group.POST("/markRead", h.MarkReadHandler)
	group.POST("/unreadCount", h.UnreadCountHandler)
}

func (h *SSEHub) listPersonalNotifications(ctx context.Context, userID uint, limit int) ([]notification.Notification, error) {
	var items []notification.Notification
	err := h.db.WithContext(ctx).
		Where("recipient_id = ? AND type IN ?", userID, supportedNotificationTypes()).
		Order("created_at desc").
		Limit(limit).
		Find(&items).Error
	return items, err
}

func (h *SSEHub) listBroadcastNotifications(ctx context.Context, userID uint, limit int) ([]notification.Notification, error) {
	var followedIDs []uint
	if err := h.db.WithContext(ctx).Table("socials").Where("follower_id = ?", userID).Pluck("vlogger_id", &followedIDs).Error; err != nil {
		return nil, err
	}
	if len(followedIDs) == 0 {
		return []notification.Notification{}, nil
	}

	var popularAuthorIDs []uint
	if err := h.db.WithContext(ctx).
		Table("socials").
		Select("vlogger_id").
		Where("vlogger_id IN ?", followedIDs).
		Group("vlogger_id").
		Having("COUNT(*) > ?", 1000).
		Pluck("vlogger_id", &popularAuthorIDs).Error; err != nil {
		return nil, err
	}
	if len(popularAuthorIDs) == 0 {
		return []notification.Notification{}, nil
	}

	var broadcasts []notification.Broadcast
	if err := h.db.WithContext(ctx).
		Where("author_id IN ?", popularAuthorIDs).
		Order("created_at desc").
		Limit(limit).
		Find(&broadcasts).Error; err != nil {
		return nil, err
	}

	items := make([]notification.Notification, 0, len(broadcasts))
	for _, item := range broadcasts {
		items = append(items, notification.Notification{
			ID:          notification.BroadcastNotificationIDOffset + item.ID,
			RecipientID: userID,
			SenderID:    item.AuthorID,
			Type:        notification.TypePublish,
			TargetID:    item.VideoID,
			Content:     item.Content,
			IsRead:      true,
			CreatedAt:   item.CreatedAt,
		})
	}
	return items, nil
}

func supportedNotificationTypes() []string {
	return []string{
		notification.TypeLike,
		notification.TypeComment,
		notification.TypeMention,
		notification.TypeMessage,
		notification.TypePublish,
	}
}

var _ NotificationHub = (*SSEHub)(nil)
