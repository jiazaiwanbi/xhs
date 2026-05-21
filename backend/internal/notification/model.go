package notification

import "time"

const (
	TypeLike    = "like"
	TypeComment = "comment"
	TypeMention = "mention"
	TypeMessage = "message"
	TypePublish = "publish"
	TypeFollow  = "follow"
)

const BroadcastNotificationIDOffset uint = 1_000_000_000

type Notification struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	RecipientID uint      `gorm:"not null;index:idx_notifications_recipient_created,priority:1;index:idx_notifications_recipient_is_read,priority:1" json:"recipient_id"`
	SenderID    uint      `gorm:"not null" json:"sender_id"`
	Type        string    `gorm:"type:varchar(50);not null" json:"type"`
	TargetID    uint      `json:"target_id"`
	Content     string    `gorm:"type:varchar(255)" json:"content"`
	IsRead      bool      `gorm:"default:false;index:idx_notifications_recipient_is_read,priority:2" json:"is_read"`
	CreatedAt   time.Time `gorm:"autoCreateTime;index:idx_notifications_recipient_created,priority:2,sort:desc" json:"created_at"`
}

type Broadcast struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	AuthorID  uint      `gorm:"not null;index:idx_broadcasts_author_created,priority:1" json:"author_id"`
	VideoID   uint      `gorm:"not null" json:"video_id"`
	Content   string    `gorm:"type:varchar(255)" json:"content"`
	CreatedAt time.Time `gorm:"autoCreateTime;index:idx_broadcasts_author_created,priority:2,sort:desc" json:"created_at"`
}

func SupportsUnreadCount(typ string) bool {
	switch typ {
	case TypeLike, TypeComment, TypeMention, TypeMessage, TypePublish:
		return true
	default:
		return false
	}
}
