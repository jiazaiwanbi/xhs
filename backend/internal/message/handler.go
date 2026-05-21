package message

import (
	"context"
	"errors"
	"strings"
	"time"

	"feedsystem_video_go/internal/apierror"
	"feedsystem_video_go/internal/middleware/jwt"
	"feedsystem_video_go/internal/worker"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Repository struct{ db *gorm.DB }
type NotificationPusher interface {
	Push(userID uint, n *worker.Notification)
}
type MessagePusher interface {
	Push(userID uint, msg *Message)
}

type Service struct {
	repo       *Repository
	notifier   NotificationPusher
	messageHub MessagePusher
}
type Handler struct{ service *Service }

func NewRepository(db *gorm.DB) *Repository { return &Repository{db: db} }
func NewService(repo *Repository, notifier NotificationPusher, messageHub MessagePusher) *Service {
	return &Service{repo: repo, notifier: notifier, messageHub: messageHub}
}
func NewHandler(service *Service) *Handler   { return &Handler{service: service} }

func (r *Repository) AutoMigrate(ctx context.Context) error {
	return r.db.WithContext(ctx).AutoMigrate(&Message{})
}

func (r *Repository) Send(ctx context.Context, m *Message) error {
	m.Content = strings.TrimSpace(m.Content)
	if m.Content == "" {
		return errors.New("content is required")
	}
	m.CreatedAt = time.Now()
	return r.db.WithContext(ctx).Create(m).Error
}

func (r *Repository) List(ctx context.Context, userID, peerID uint, limit int) ([]Message, error) {
	var msgs []Message
	err := r.db.WithContext(ctx).
		Where("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)", userID, peerID, peerID, userID).
		Order("created_at desc").
		Limit(limit).
		Find(&msgs).Error
	return msgs, err
}

func buildNotificationPreview(content string) string {
	content = strings.TrimSpace(content)
	runes := []rune(content)
	if len(runes) > 48 {
		return string(runes[:48]) + "..."
	}
	return content
}

func (s *Service) Send(ctx context.Context, m *Message) error {
	if m == nil {
		return errors.New("message is nil")
	}
	m.Content = strings.TrimSpace(m.Content)
	if m.Content == "" {
		return errors.New("content is required")
	}
	m.CreatedAt = time.Now()

	notif := &worker.Notification{
		RecipientID: m.ToID,
		SenderID:    m.FromID,
		Type:        "message",
		TargetID:    m.FromID,
		Content:     buildNotificationPreview(m.Content),
	}

	if err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(m).Error; err != nil {
			return err
		}
		return tx.Create(notif).Error
	}); err != nil {
		return err
	}

	if s.notifier != nil {
		s.notifier.Push(notif.RecipientID, notif)
	}
	if s.messageHub != nil {
		s.messageHub.Push(m.ToID, m)
	}
	return nil
}

func (h *Handler) Send(c *gin.Context) {
	fromID, err := jwt.GetAccountID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	var req SendRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.ToID == 0 || strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to_id and content are required"})
		return
	}
	m := &Message{FromID: fromID, ToID: req.ToID, Content: req.Content}
	if err := h.service.Send(c.Request.Context(), m); err != nil {
		c.JSON(apierror.ClassifyHTTPStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) List(c *gin.Context) {
	userID, err := jwt.GetAccountID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": err.Error()})
		return
	}
	var req ListRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.PeerID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "peer_id is required"})
		return
	}
	msgs, err := h.service.repo.List(c.Request.Context(), userID, req.PeerID, 50)
	if err != nil {
		c.JSON(apierror.ClassifyHTTPStatus(err), gin.H{"error": err.Error()})
		return
	}
	if msgs == nil {
		msgs = []Message{}
	}
	c.JSON(http.StatusOK, ListResponse{Messages: msgs})
}
