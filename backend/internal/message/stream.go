package message

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"feedsystem_video_go/internal/auth"

	"github.com/gin-gonic/gin"
)

type StreamHub struct {
	mu      sync.RWMutex
	clients map[uint][]chan *Message
}

func NewStreamHub() *StreamHub {
	return &StreamHub{clients: make(map[uint][]chan *Message)}
}

func (h *StreamHub) Push(userID uint, msg *Message) {
	if h == nil || msg == nil || userID == 0 {
		return
	}
	h.mu.RLock()
	chs, ok := h.clients[userID]
	h.mu.RUnlock()
	if !ok {
		return
	}
	for _, ch := range chs {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (h *StreamHub) subscribe(userID uint) chan *Message {
	ch := make(chan *Message, 20)
	h.mu.Lock()
	h.clients[userID] = append(h.clients[userID], ch)
	h.mu.Unlock()
	return ch
}

func (h *StreamHub) unsubscribe(userID uint, ch chan *Message) {
	h.mu.Lock()
	defer h.mu.Unlock()
	chs := h.clients[userID]
	for i, current := range chs {
		if current == ch {
			h.clients[userID] = append(chs[:i], chs[i+1:]...)
			close(current)
			break
		}
	}
	if len(h.clients[userID]) == 0 {
		delete(h.clients, userID)
	}
}

func StreamRequireAuth() gin.HandlerFunc {
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

func (h *StreamHub) StreamHandler(c *gin.Context) {
	accountID, _ := c.Get("accountID")
	userID := accountID.(uint)

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.WriteHeader(http.StatusOK)

	ch := h.subscribe(userID)
	defer h.unsubscribe(userID, ch)

	ctx := c.Request.Context()
	flusher, _ := c.Writer.(http.Flusher)

	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(msg)
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
