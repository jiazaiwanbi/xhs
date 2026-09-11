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
	Images   int
	Likes    int
	Comments int
	Follows  int
}

type Result struct {
	Users    int64
	Videos   int64
	Images   int64
	Likes    int64
	Comments int64
	Follows  int64
}

type media struct {
	playURL string
}

var mediaLibrary = []media{
	{
		playURL: "https://media.w3.org/2010/05/sintel/trailer.mp4",
	},
	{
		playURL: "https://media.w3.org/2010/05/bunny/trailer.mp4",
	},
}

var seedImageTitles = []string{
	"周末去山里吹吹风", "今天也要好好吃饭", "把春天装进相册", "城市散步随手拍",
	"我的治愈系小角落", "下班后的松弛时刻", "最近很喜欢的穿搭", "巷子里的宝藏小店",
	"阳光落在窗边", "和毛孩子的一天", "旅行中最难忘的一站", "简单又满足的早餐",
}

var seedVideoTitles = []string{
	"一分钟记录今日份快乐", "晚霞出现的那一刻", "跟着镜头去旅行", "今天的厨房日记",
	"城市夜晚慢慢走", "周末生活碎片", "好天气值得被记录", "拆箱最近的新发现",
}

var seedImageTitleDetails = []string{
	"值得收藏的小发现", "被这一幕治愈了", "分享今日好心情", "慢下来感受生活",
	"原图真的很有氛围", "随手拍也很出片", "藏在日常里的浪漫", "终于来打卡了",
	"近期生活小结", "这一刻想和你分享", "普通日子也闪闪发光", "我的私藏清单",
	"好喜欢今天的光", "记录一些新鲜事", "简单生活的幸福感", "今天的灵感来源",
	"一眼就心动的画面", "生活需要一点仪式感", "最近反复喜欢的瞬间", "把快乐存进相册",
}

var seedVideoTitleDetails = []string{
	"现场比镜头更美", "请查收今日份治愈", "沉浸式感受一下", "看到最后有惊喜",
	"循环播放好多遍", "用镜头留住这一秒", "氛围感直接拉满", "一起看看沿途风景",
}

func (o Options) Validate() error {
	if o.Users < 0 || o.Videos < 0 || o.Images < 0 || o.Likes < 0 || o.Comments < 0 || o.Follows < 0 {
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
	if o.Videos > len(coverAssetIDs) {
		return fmt.Errorf("videos exceeds the %d unique seed covers available", len(coverAssetIDs))
	}
	if o.Images > o.Videos {
		return errors.New("images cannot exceed the total seeded notes")
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
	coverCtx, cancelCoverDownloads := context.WithTimeout(ctx, 90*time.Second)
	coverURLs := prepareCoverURLs(coverCtx, opts.Videos)
	cancelCoverDownloads()

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
			seededVideos, err = upsertVideos(tx, opts.Videos, opts.Images, users, coverURLs)
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

func upsertVideos(tx *gorm.DB, count, imageCount int, users []account.Account, coverURLs []string) ([]video.Video, error) {
	for i := 1; i <= count; i++ {
		author := users[(i-1)%len(users)]
		asset := mediaLibrary[(i-1)%len(mediaLibrary)]
		seedKey := fmt.Sprintf("note-%04d", i)
		isImage := isSeedImageNote(i, count, imageCount)
		typeOrdinal := seedContentTypeOrdinal(i, count, imageCount, isImage)
		contentType := video.ContentTypeVideo
		playURL := asset.playURL
		var imageURLs []string
		title := buildSeedTitle(typeOrdinal, false)
		if isImage {
			contentType = video.ContentTypeImage
			playURL = ""
			imageURLs = []string{coverURLs[i-1]}
			title = buildSeedTitle(typeOrdinal, true)
		}
		row := video.Video{
			SeedKey:     &seedKey,
			AuthorID:    author.ID,
			Username:    author.Username,
			Title:       title,
			Description: fmt.Sprintf("记录生活里值得分享的小瞬间 #%s", []string{"旅行", "生活", "穿搭", "美食", "家居", "宠物"}[(i-1)%6]),
			PlayURL:     playURL,
			CoverURL:    coverURLs[i-1],
			ContentType: contentType,
			ImageURLs:   imageURLs,
			CreateTime:  time.Now().Add(-time.Duration(count-i) * 3 * time.Minute).Truncate(time.Millisecond),
		}
		var existing video.Video
		legacyTitle := fmt.Sprintf("[seed:%04d] Feed 测试视频 %04d", i, i)
		err := tx.Where("seed_key = ? OR (seed_key IS NULL AND title = ?)", seedKey, legacyTitle).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(&row).Error; err != nil {
				return nil, fmt.Errorf("seed video %d: %w", i, err)
			}
		} else if err != nil {
			return nil, err
		} else if err := tx.Model(&existing).Select(
			"SeedKey", "AuthorID", "Username", "Title", "Description", "PlayURL", "CoverURL", "ContentType", "ImageURLs",
		).Updates(&row).Error; err != nil {
			return nil, err
		}
	}
	var rows []video.Video
	if count == 0 {
		return rows, nil
	}
	if err := tx.Where("seed_key IN ?", seedKeys(count)).Order("seed_key ASC").Find(&rows).Error; err != nil {
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
		target := videos[(i-1)%len(videos)]
		seedKey := fmt.Sprintf("comment-%06d", i)
		content := []string{"好有氛围感！", "收藏了，下次也去看看", "这个分享太实用了", "今天也被治愈到了", "拍得真好看", "很喜欢这种生活感"}[(i-1)%6]
		if target.ContentType == video.ContentTypeVideo {
			content = []string{"这个视频太有感觉了", "镜头语言很喜欢", "看到最后真的惊喜", "已经循环播放了"}[(i-1)%4]
		}
		row := video.Comment{
			SeedKey:  &seedKey,
			Username: author.Username,
			AuthorID: author.ID,
			VideoID:  target.ID,
			Content:  content,
		}
		legacyContent := fmt.Sprintf("[seed:%06d] 很棒的测试视频！", i)
		var existing video.Comment
		err := tx.Where("seed_key = ? OR (seed_key IS NULL AND content = ?)", seedKey, legacyContent).First(&existing).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = tx.Create(&row).Error
		} else if err == nil {
			err = tx.Model(&existing).Select("SeedKey", "Username", "AuthorID", "VideoID", "Content").Updates(&row).Error
		}
		if err != nil {
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
		item := readmodel.NewFeedVideoItem(row.ID, row.AuthorID, row.Username, row.Title, row.Description, row.PlayURL, row.CoverURL, row.ContentType, row.ImageURLs, row.CreateTime, row.LikesCount, row.Popularity)
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
	keys := seedKeys(opts.Videos)
	if opts.Videos > 0 {
		if err := database.Model(&video.Video{}).Where("seed_key IN ?", keys).Count(&result.Videos).Error; err != nil {
			return result, err
		}
		if err := database.Model(&video.Video{}).Where("seed_key IN ? AND content_type = ?", keys, video.ContentTypeImage).Count(&result.Images).Error; err != nil {
			return result, err
		}
		if err := database.Model(&video.Like{}).Where("video_id IN (?)", database.Model(&video.Video{}).Select("id").Where("seed_key IN ?", keys)).Count(&result.Likes).Error; err != nil {
			return result, err
		}
	}
	if opts.Comments > 0 {
		if err := database.Model(&video.Comment{}).Where("seed_key LIKE ?", "comment-%").Count(&result.Comments).Error; err != nil {
			return result, err
		}
	}
	if opts.Users > 0 {
		ids := database.Model(&account.Account{}).Select("id").Where("username IN ?", seedUsernames(opts.Users))
		if err := database.Model(&social.Social{}).Where("follower_id IN (?) AND vlogger_id IN (?)", ids, ids).Count(&result.Follows).Error; err != nil {
			return result, err
		}
	}
	log.Printf("seed complete: users=%d notes=%d images=%d videos=%d likes=%d comments=%d follows=%d", result.Users, result.Videos, result.Images, result.Videos-result.Images, result.Likes, result.Comments, result.Follows)
	return result, nil
}

func seedUsernames(count int) []string {
	rows := make([]string, count)
	for i := range rows {
		rows[i] = fmt.Sprintf("user%03d", i+1)
	}
	return rows
}

func seedKeys(count int) []string {
	rows := make([]string, count)
	for i := range rows {
		rows[i] = fmt.Sprintf("note-%04d", i+1)
	}
	return rows
}

func buildSeedTitle(index int, image bool) string {
	if image {
		baseIndex := (index - 1) % len(seedImageTitles)
		detailIndex := ((index - 1) / len(seedImageTitles)) % len(seedImageTitleDetails)
		return seedImageTitles[baseIndex] + "｜" + seedImageTitleDetails[detailIndex]
	}
	baseIndex := (index - 1) % len(seedVideoTitles)
	detailIndex := ((index - 1) / len(seedVideoTitles)) % len(seedVideoTitleDetails)
	return seedVideoTitles[baseIndex] + "｜" + seedVideoTitleDetails[detailIndex]
}

func isSeedImageNote(index, total, imageCount int) bool {
	if index <= 0 || total <= 0 || imageCount <= 0 {
		return false
	}
	return index*imageCount/total > (index-1)*imageCount/total
}

func seedContentTypeOrdinal(index, total, imageCount int, image bool) int {
	imagesThroughIndex := index * imageCount / total
	if image {
		return imagesThroughIndex
	}
	return index - imagesThroughIndex
}
