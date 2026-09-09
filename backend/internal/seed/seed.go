package seed

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"time"

	"feedsystem_video_go/internal/account"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/readmodel"
	"feedsystem_video_go/internal/social"
	"feedsystem_video_go/internal/video"

	oredis "github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const DefaultPassword = "123456"

type Options struct {
	Users    int
	Videos   int
	Likes    int
	Comments int
	Follows  int
}

type Result struct {
	Users    int64
	Videos   int64
	Likes    int64
	Comments int64
	Follows  int64
}

type media struct {
	playURL  string
	coverURL string
}

var mediaLibrary = []media{
	{
		playURL:  "https://media.w3.org/2010/05/sintel/trailer.mp4",
		coverURL: "https://media.w3.org/2010/05/sintel/poster.png",
	},
	{
		playURL:  "https://media.w3.org/2010/05/bunny/trailer.mp4",
		coverURL: "https://media.w3.org/2010/05/bunny/poster.png",
	},
}

func (o Options) Validate() error {
	if o.Users < 0 || o.Videos < 0 || o.Likes < 0 || o.Comments < 0 || o.Follows < 0 {
		return errors.New("seed counts must be non-negative")
	}
	if o.Users == 0 && (o.Videos > 0 || o.Likes > 0 || o.Comments > 0 || o.Follows > 0) {
		return errors.New("users must be greater than zero when generating related data")
	}
	if o.Videos == 0 && (o.Likes > 0 || o.Comments > 0) {
		return errors.New("videos must be greater than zero when generating likes or comments")
	}
	if int64(o.Likes) > int64(o.Users)*int64(o.Videos) {
		return fmt.Errorf("likes exceeds the maximum of users * videos (%d)", o.Users*o.Videos)
	}
	if int64(o.Follows) > int64(o.Users)*int64(max(o.Users-1, 0)) {
		return fmt.Errorf("follows exceeds the maximum of users * (users - 1) (%d)", o.Users*max(o.Users-1, 0))
	}
	return nil
}

// Run inserts deterministic records. Stable natural keys and unique database
// indexes make running the same seed command repeatedly idempotent.
func Run(ctx context.Context, database *gorm.DB, cache *rediscache.Client, opts Options) (Result, error) {
	if err := opts.Validate(); err != nil {
		return Result{}, err
	}
	if database == nil {
		return Result{}, errors.New("database is required")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(DefaultPassword), bcrypt.DefaultCost)
	if err != nil {
		return Result{}, fmt.Errorf("hash seed password: %w", err)
	}

	var seededVideos []video.Video
	err = database.WithContext(ctx).Connection(func(conn *gorm.DB) error {
		var locked int
		if err := conn.Raw("SELECT GET_LOCK(?, 30)", "feedsystem_seed_v1").Scan(&locked).Error; err != nil {
			return fmt.Errorf("acquire seed lock: %w", err)
		}
		if locked != 1 {
			return errors.New("timed out waiting for another seed process")
		}
		defer func() { _ = conn.Exec("SELECT RELEASE_LOCK(?)", "feedsystem_seed_v1").Error }()

		return conn.Transaction(func(tx *gorm.DB) error {
			users, err := upsertUsers(tx, opts.Users, string(hash))
			if err != nil {
				return err
			}
			seededVideos, err = upsertVideos(tx, opts.Videos, users)
			if err != nil {
				return err
			}
			if err := upsertLikes(tx, opts.Likes, users, seededVideos); err != nil {
				return err
			}
			if err := upsertComments(tx, opts.Comments, users, seededVideos); err != nil {
				return err
			}
			if err := upsertFollows(tx, opts.Follows, users); err != nil {
				return err
			}
			return refreshCounts(tx, seededVideos)
		})
	})
	if err != nil {
		return Result{}, err
	}

	if cache != nil {
		// Rebuild from every video, not only seed-owned rows, so running this tool
		// in a development database does not evict hand-created content from Feed.
		var cacheVideos []video.Video
		if err := database.WithContext(ctx).Order("create_time ASC, id ASC").Find(&cacheVideos).Error; err != nil {
			return Result{}, fmt.Errorf("load videos for Redis rebuild: %w", err)
		}
		if err := rebuildFeedCache(ctx, cache, cacheVideos); err != nil {
			return Result{}, fmt.Errorf("rebuild Redis feed cache: %w", err)
		}
	}

	return inspectResult(database, opts)
}

func upsertUsers(tx *gorm.DB, count int, passwordHash string) ([]account.Account, error) {
	for i := 1; i <= count; i++ {
		username := fmt.Sprintf("user%03d", i)
		row := account.Account{
			Username:  username,
			Password:  passwordHash,
			AvatarURL: fmt.Sprintf("https://api.dicebear.com/9.x/thumbs/svg?seed=%s", username),
			Bio:       fmt.Sprintf("Feed 测试用户 %03d", i),
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "username"}},
			DoUpdates: clause.AssignmentColumns([]string{"password", "avatar_url", "bio"}),
		}).Create(&row).Error; err != nil {
			return nil, fmt.Errorf("seed user %d: %w", i, err)
		}
	}
	var users []account.Account
	if count == 0 {
		return users, nil
	}
	if err := tx.Where("username IN ?", seedUsernames(count)).Order("username ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	if len(users) != count {
		return nil, fmt.Errorf("expected %d seed users, found %d", count, len(users))
	}
	return users, nil
}

func upsertVideos(tx *gorm.DB, count int, users []account.Account) ([]video.Video, error) {
	for i := 1; i <= count; i++ {
		author := users[(i-1)%len(users)]
		asset := mediaLibrary[(i-1)%len(mediaLibrary)]
		title := fmt.Sprintf("[seed:%04d] Feed 测试视频 %04d", i, i)
		row := video.Video{
			AuthorID:    author.ID,
			Username:    author.Username,
			Title:       title,
			Description: fmt.Sprintf("可重复生成的 Feed 测试数据 #%s #seed", []string{"旅行", "生活", "技术", "美食"}[(i-1)%4]),
			PlayURL:     asset.playURL,
			CoverURL:    asset.coverURL,
			CreateTime:  time.Now().Add(-time.Duration(count-i) * 3 * time.Minute).Truncate(time.Millisecond),
		}
		var existing video.Video
		err := tx.Where("title = ?", title).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(&row).Error; err != nil {
				return nil, fmt.Errorf("seed video %d: %w", i, err)
			}
		} else if err != nil {
			return nil, err
		} else if err := tx.Model(&existing).Updates(map[string]any{
			"author_id": author.ID, "username": author.Username, "description": row.Description,
			"play_url": row.PlayURL, "cover_url": row.CoverURL,
		}).Error; err != nil {
			return nil, err
		}
	}
	var rows []video.Video
	if count == 0 {
		return rows, nil
	}
	if err := tx.Where("title IN ?", seedVideoTitles(count)).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) != count {
		return nil, fmt.Errorf("expected %d seed videos, found %d", count, len(rows))
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Title < rows[j].Title })
	return rows, nil
}

func upsertLikes(tx *gorm.DB, count int, users []account.Account, videos []video.Video) error {
	rows := make([]video.Like, 0, count)
	for i := 0; i < count; i++ {
		rows = append(rows, video.Like{VideoID: videos[i%len(videos)].ID, AccountID: users[(i/len(videos))%len(users)].ID})
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 500).Error
}

func upsertComments(tx *gorm.DB, count int, users []account.Account, videos []video.Video) error {
	for i := 1; i <= count; i++ {
		author := users[(i-1)%len(users)]
		row := video.Comment{
			Username: author.Username,
			AuthorID: author.ID,
			VideoID:  videos[(i-1)%len(videos)].ID,
			Content:  fmt.Sprintf("[seed:%06d] 很棒的测试视频！", i),
		}
		if err := tx.Where("content = ?", row.Content).FirstOrCreate(&row).Error; err != nil {
			return fmt.Errorf("seed comment %d: %w", i, err)
		}
	}
	return nil
}

func upsertFollows(tx *gorm.DB, count int, users []account.Account) error {
	rows := make([]social.Social, 0, count)
	for follower := 0; follower < len(users) && len(rows) < count; follower++ {
		for offset := 1; offset < len(users) && len(rows) < count; offset++ {
			rows = append(rows, social.Social{FollowerID: users[follower].ID, VloggerID: users[(follower+offset)%len(users)].ID})
		}
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(rows, 500).Error
}

func refreshCounts(tx *gorm.DB, videos []video.Video) error {
	for _, row := range videos {
		var likes, comments int64
		if err := tx.Model(&video.Like{}).Where("video_id = ?", row.ID).Count(&likes).Error; err != nil {
			return err
		}
		if err := tx.Model(&video.Comment{}).Where("video_id = ?", row.ID).Count(&comments).Error; err != nil {
			return err
		}
		if err := tx.Model(&video.Video{}).Where("id = ?", row.ID).
			Updates(map[string]any{"likes_count": likes, "popularity": likes + comments}).Error; err != nil {
			return err
		}
		row.LikesCount = likes
		row.Popularity = likes + comments
	}
	return nil
}

func rebuildFeedCache(ctx context.Context, cache *rediscache.Client, videos []video.Video) error {
	patterns := []string{
		cache.Key("feed:*"), cache.Key("video:entity:*"), cache.Key("video:detail:*"), cache.Key("hot:video:*"),
	}
	for _, pattern := range patterns {
		if err := cache.DeletePattern(ctx, pattern); err != nil {
			return err
		}
	}
	if len(videos) == 0 {
		return nil
	}

	timeline := make([]oredis.Z, 0, len(videos))
	hot := make([]oredis.Z, 0, len(videos))
	for _, row := range videos {
		member := fmt.Sprintf("%d", row.ID)
		timeline = append(timeline, oredis.Z{Score: float64(row.CreateTime.UnixMilli()), Member: member})
		hot = append(hot, oredis.Z{Score: float64(row.Popularity), Member: member})
		item := readmodel.NewFeedVideoItem(row.ID, row.AuthorID, row.Username, row.Title, row.Description, row.PlayURL, row.CoverURL, row.CreateTime, row.LikesCount, row.Popularity)
		if err := readmodel.SaveFeedVideoItem(ctx, cache, item, readmodel.FeedVideoItemTTL); err != nil {
			return err
		}
	}
	if len(timeline) > 1000 {
		timeline = timeline[len(timeline)-1000:]
	}
	if err := cache.ZAdd(ctx, cache.Key("feed:global_timeline"), timeline...); err != nil {
		return err
	}
	hotKey := cache.Key("hot:video:1m:%s", time.Now().UTC().Truncate(time.Minute).Format("200601021504"))
	if err := cache.ZAdd(ctx, hotKey, hot...); err != nil {
		return err
	}
	return cache.Expire(ctx, hotKey, 2*time.Hour)
}

func inspectResult(database *gorm.DB, opts Options) (Result, error) {
	var result Result
	if opts.Users > 0 {
		if err := database.Model(&account.Account{}).Where("username IN ?", seedUsernames(opts.Users)).Count(&result.Users).Error; err != nil {
			return result, err
		}
	}
	titles := seedVideoTitles(opts.Videos)
	if opts.Videos > 0 {
		if err := database.Model(&video.Video{}).Where("title IN ?", titles).Count(&result.Videos).Error; err != nil {
			return result, err
		}
		if err := database.Model(&video.Like{}).Where("video_id IN (?)", database.Model(&video.Video{}).Select("id").Where("title IN ?", titles)).Count(&result.Likes).Error; err != nil {
			return result, err
		}
	}
	if opts.Comments > 0 {
		if err := database.Model(&video.Comment{}).Where("content LIKE ?", "[seed:%").Count(&result.Comments).Error; err != nil {
			return result, err
		}
	}
	if opts.Users > 0 {
		ids := database.Model(&account.Account{}).Select("id").Where("username IN ?", seedUsernames(opts.Users))
		if err := database.Model(&social.Social{}).Where("follower_id IN (?) AND vlogger_id IN (?)", ids, ids).Count(&result.Follows).Error; err != nil {
			return result, err
		}
	}
	log.Printf("seed complete: users=%d videos=%d likes=%d comments=%d follows=%d", result.Users, result.Videos, result.Likes, result.Comments, result.Follows)
	return result, nil
}

func seedUsernames(count int) []string {
	rows := make([]string, count)
	for i := range rows {
		rows[i] = fmt.Sprintf("user%03d", i+1)
	}
	return rows
}

func seedVideoTitles(count int) []string {
	rows := make([]string, count)
	for i := range rows {
		rows[i] = fmt.Sprintf("[seed:%04d] Feed 测试视频 %04d", i+1, i+1)
	}
	return rows
}
