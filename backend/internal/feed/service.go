package feed

import (
	"context"
	"encoding/json"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/readmodel"
	"feedsystem_video_go/internal/video"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/patrickmn/go-cache"
	redis "github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

type FeedService struct {
	repo         *FeedRepository
	likeRepo     *video.LikeRepository
	rediscache   *rediscache.Client
	localcache   *cache.Cache
	cacheTTL     time.Duration
	requestGroup singleflight.Group
}

type CachedFeedData struct {
	PublicVideos []video.Video `json:"public_videos"`
}

func NewFeedService(repo *FeedRepository, likeRepo *video.LikeRepository, rediscache *rediscache.Client) *FeedService {
	return &FeedService{repo: repo, likeRepo: likeRepo, rediscache: rediscache, localcache: cache.New(3*time.Second, 5*time.Second), cacheTTL: 24 * time.Hour}
}

const hotReadLocalTTL = 2 * time.Second

func (f *FeedService) GetVideoByIDs(ctx context.Context, videoIDs []uint) ([]*video.Video, error) {
	// GetVideoByIDs 批量获取视频信息
	// 采用 L1(本地缓存) -> L2(Redis) -> L3(MySQL) 三级架构
	if len(videoIDs) == 0 {
		return []*video.Video{}, nil
	}

	videoMap := make(map[uint]*video.Video)
	//L1:本地缓存
	var missedL1 []uint
	for _, id := range videoIDs {
		cacheKey := f.rediscache.Key("video:entity:%d", id)
		if f.localcache != nil {
			if v, found := f.localcache.Get(cacheKey); found {
				if data, ok := v.(video.Video); ok {
					videoMap[id] = &data
					continue
				}
			}
		}
		// 记录未命中的 ID，准备进入下一级缓存
		missedL1 = append(missedL1, id)
	}

	if len(missedL1) == 0 {
		return buildOrderedResult(videoIDs, videoMap), nil
	}

	//L2:redis
	var missedL2 []uint
	if len(missedL1) > 0 {
		cacheKeys := make([]string, len(missedL1))
		for i, id := range missedL1 {
			cacheKeys[i] = f.rediscache.Key("video:entity:%d", id)
		}

		cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		results, err := f.rediscache.MGet(cacheCtx, cacheKeys...)
		cancel()

		if err == nil {
			for i, res := range results {
				id := missedL1[i]
				if res != nil {
					if str, ok := res.(string); ok {
						var v video.Video
						if err := json.Unmarshal([]byte(str), &v); err == nil {
							videoMap[id] = &v
							// 回写更新 L1 本地缓存
							if f.localcache != nil {
								f.localcache.Set(cacheKeys[i], v, 5*time.Second)
							}
							continue
						}
					}
				}
				missedL2 = append(missedL2, id)
			}
		} else {
			// 如果 Redis 挂了或者超时了，全部降级到 L3
			missedL2 = missedL1
			log.Printf("L2 Redis MGet 失败，全部降级到 MySQL: %v", err)
		}
	}

	if len(missedL2) == 0 {
		return buildOrderedResult(videoIDs, videoMap), nil
	}

	// L3: MySQL. Batch the misses so one feed page does not fan out into N queries.
	sfKey := f.rediscache.Key("sf:entity:batch:%s", joinUintIDs(missedL2))
	v, err, _ := f.requestGroup.Do(sfKey, func() (interface{}, error) {
		return f.repo.GetByIDs(ctx, missedL2)
	})
	if err != nil {
		return nil, err
	}
	for _, dbVideo := range v.([]*video.Video) {
		if dbVideo == nil {
			continue
		}
		safeCopy := *dbVideo
		videoMap[safeCopy.ID] = &safeCopy
		cacheKey := f.rediscache.Key("video:entity:%d", safeCopy.ID)
		if f.localcache != nil {
			f.localcache.Set(cacheKey, safeCopy, 5*time.Second)
		}
		if f.rediscache != nil {
			if b, err := json.Marshal(safeCopy); err == nil {
				go func(k string, b []byte) {
					setCtx, setCancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
					defer setCancel()
					_ = f.rediscache.SetBytes(setCtx, k, b, time.Hour)
				}(cacheKey, b)
			}
		}
	}
	return buildOrderedResult(videoIDs, videoMap), nil
}

// 查询最新视频 (冷热分离 + 游标分页)
func (f *FeedService) ListLatest(ctx context.Context, limit int, latestBefore time.Time, viewerAccountID uint) (ListLatestResponse, error) {
	// 获取 ZSET 中最老的一条数据
	zsetTail, err := f.rediscache.ZRangeWithScores(ctx, f.rediscache.Key("feed:global_timeline"), 0, 0)

	if err != nil {
		return ListLatestResponse{}, err
	}

	isZsetEmpty := len(zsetTail) == 0

	if isZsetEmpty {
		//全局静态锁：无视所有用户的不同时间戳游标
		sfKey := f.rediscache.Key("sf:fallback:global_timeline_rebuild")

		v, err, _ := f.requestGroup.Do(sfKey, func() (interface{}, error) {
			// 无视游标，直接去 MySQL 捞最新的 1000 条
			dbVideos, err := f.repo.ListLatest(ctx, 1000, time.Time{})
			if err != nil {
				return nil, err
			}
			if len(dbVideos) == 0 {
				return "EMPTY_DB", nil // 防无限递归
			}

			// 重建 ZSET
			bgCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			var zElements []redis.Z
			for _, vid := range dbVideos {
				zElements = append(zElements, redis.Z{
					Score:  float64(vid.CreateTime.UnixMilli()),
					Member: fmt.Sprintf("%d", vid.ID),
				})
			}
			f.rediscache.ZAdd(bgCtx, f.rediscache.Key("feed:global_timeline"), zElements...)
			return "SUCCESS", nil
		})

		if err != nil {
			return ListLatestResponse{}, err
		}
		if v == "EMPTY_DB" {
			return ListLatestResponse{HasMore: false}, nil
		}

		// 让所有被阻塞的请求重新查一遍
		return f.ListLatest(ctx, limit, latestBefore, viewerAccountID)
	}

	watermark := int64(zsetTail[0].Score)
	reqTime := time.Now().UnixMilli()
	if !latestBefore.IsZero() {
		reqTime = latestBefore.UnixMilli()
	}

	var (
		baseVideos []*video.Video
		feedVideos []FeedVideoItem
	)
	usedReadModel := false

	if reqTime <= watermark {
		//冷数据降级查库

		// 针对个别用户的防并发（此时可以用时间戳做锁，因为冷尾流量极小）
		sfKey := f.rediscache.Key("sf:cold:listLatest:%d:%d", limit, reqTime)
		v, err, _ := f.requestGroup.Do(sfKey, func() (interface{}, error) {
			return f.repo.ListLatest(ctx, limit, latestBefore)
		})
		if err != nil {
			return ListLatestResponse{}, err
		}
		baseVideos = v.([]*video.Video)
		// 不回写 ZSET，防止冷数据污染热点时间线

	} else {
		// 热数据直接查redis
		maxScore := "+inf"
		if !latestBefore.IsZero() {
			maxScore = fmt.Sprintf("%d", reqTime-1) // 防重复
		}

		videoIDsStr, err := f.rediscache.ZRevRangeByScore(ctx, f.rediscache.Key("feed:global_timeline"), maxScore, "-inf", 0, int64(limit))
		if err != nil {
			return ListLatestResponse{}, err
		}

		var videoIDs []uint
		for _, idStr := range videoIDsStr {
			if id, err := strconv.ParseUint(idStr, 10, 64); err == nil {
				videoIDs = append(videoIDs, uint(id))
			}
		}

		if len(videoIDs) > 0 {
			feedVideos, err = f.GetFeedItemsByIDs(ctx, videoIDs, viewerAccountID)
			if err != nil {
				return ListLatestResponse{}, err
			}
			usedReadModel = len(feedVideos) > 0
		}

		// 刚好击穿了冷热边界
		if len(feedVideos) < limit {
			remainLimit := limit - len(feedVideos) // 计算还差几个

			var coldCursor time.Time
			if len(feedVideos) > 0 {
				coldCursor = time.Unix(feedVideos[len(feedVideos)-1].CreateTime, 0)
			} else {
				coldCursor = latestBefore
			}

			sfKey := f.rediscache.Key("sf:stitch:listLatest:%d:%d", remainLimit, coldCursor.UnixMilli())
			v, err, _ := f.requestGroup.Do(sfKey, func() (interface{}, error) {
				return f.repo.ListLatest(ctx, remainLimit, coldCursor)
			})

			if err == nil {
				coldVideos := v.([]*video.Video)
				coldFeedVideos, buildErr := f.buildFeedVideos(ctx, coldVideos, viewerAccountID)
				if buildErr != nil {
					return ListLatestResponse{}, buildErr
				}
				feedVideos = append(feedVideos, coldFeedVideos...)
			}
		}
	}

	var nextTime int64
	if len(feedVideos) > 0 {
		// 将本页最后一条视频的时间作为下一次请求的游标
		nextTime = feedVideos[len(feedVideos)-1].CreateTime * 1000
	}
	var hasMore bool

	hasMore = len(feedVideos) == limit

	if len(baseVideos) > 0 && !usedReadModel {
		feedVideos, err = f.buildFeedVideos(ctx, baseVideos, viewerAccountID)
		if err != nil {
			return ListLatestResponse{}, err
		}
	}

	return ListLatestResponse{
		VideoList: feedVideos,
		NextTime:  nextTime,
		HasMore:   hasMore,
	}, nil
}

// 按照点赞数查询视频
func (f *FeedService) ListLikesCount(ctx context.Context, limit int, cursor *LikesCountCursor, viewerAccountID uint) (ListLikesCountResponse, error) {
	cacheKey := ""
	if viewerAccountID == 0 && cursor == nil && f.localcache != nil {
		cacheKey = fmt.Sprintf("feed:listLikesCount:anon:first:limit=%d", limit)
		if cached, ok := f.localcache.Get(cacheKey); ok {
			if resp, ok := cached.(ListLikesCountResponse); ok {
				return resp, nil
			}
		}
	}
	videos, err := f.repo.ListLikesCountWithCursor(ctx, limit, cursor)
	if err != nil {
		return ListLikesCountResponse{}, err
	}
	hasMore := len(videos) == limit
	feedVideos, err := f.buildFeedVideos(ctx, videos, viewerAccountID)
	if err != nil {
		return ListLikesCountResponse{}, err
	}
	resp := ListLikesCountResponse{
		VideoList: feedVideos,
		HasMore:   hasMore,
	}
	if len(videos) > 0 {
		last := videos[len(videos)-1]
		nextLikesCountBefore := last.LikesCount
		nextIDBefore := last.ID
		resp.NextLikesCountBefore = &nextLikesCountBefore
		resp.NextIDBefore = &nextIDBefore
	}
	if cacheKey != "" {
		f.localcache.Set(cacheKey, resp, hotReadLocalTTL)
	}
	return resp, nil
}

// 按照关注列表查询视频
func (f *FeedService) ListByFollowing(ctx context.Context, limit int, latestBefore time.Time, viewerAccountID uint) (ListByFollowingResponse, error) {
	doListByFollowingFromDB := func() (ListByFollowingResponse, error) {
		videos, err := f.repo.ListByFollowing(ctx, limit, viewerAccountID, latestBefore)
		if err != nil {
			return ListByFollowingResponse{}, err
		}
		var nextTime int64
		if len(videos) > 0 {
			nextTime = videos[len(videos)-1].CreateTime.Unix()
		} else {
			nextTime = 0
		}
		hasMore := len(videos) == limit
		feedVideos, err := f.buildFeedVideos(ctx, videos, viewerAccountID)
		if err != nil {
			return ListByFollowingResponse{}, err
		}
		resp := ListByFollowingResponse{
			VideoList: feedVideos,
			NextTime:  nextTime,
			HasMore:   hasMore,
		}
		return resp, nil
	}
	var cacheKey string
	if viewerAccountID != 0 && f.rediscache != nil {
		before := int64(0)
		if !latestBefore.IsZero() {
			before = latestBefore.Unix()
		}
		cacheKey = f.rediscache.Key("feed:listByFollowing:limit=%d:accountID=%d:before=%d", limit, viewerAccountID, before)
		cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		defer cancel()

		b, err := f.rediscache.GetBytes(cacheCtx, cacheKey)
		if err == nil {
			var cached ListByFollowingResponse
			if err := json.Unmarshal(b, &cached); err == nil {
				return cached, nil
			}
		} else if rediscache.IsMiss(err) { // 缓存未命中
			lockKey := "lock:" + cacheKey
			// 缓存未命中，尝试加锁
			token, locked, _ := f.rediscache.Lock(cacheCtx, lockKey, 500*time.Millisecond)
			if locked {
				defer func() { _ = f.rediscache.Unlock(context.Background(), lockKey, token) }()
				if b, err := f.rediscache.GetBytes(cacheCtx, cacheKey); err == nil {
					var cached ListByFollowingResponse
					if err := json.Unmarshal(b, &cached); err == nil {
						return cached, nil
					}
				} else { // 缓存未命中，从数据库中查询
					resp, err := doListByFollowingFromDB()
					if err != nil {
						return ListByFollowingResponse{}, err
					}
					if b, err := json.Marshal(resp); err == nil {
						_ = f.rediscache.SetBytes(cacheCtx, cacheKey, b, f.cacheTTL)
					}
					return resp, nil
				}
			} else {
				for i := 0; i < 5; i++ {
					time.Sleep(20 * time.Millisecond)
					if b, err := f.rediscache.GetBytes(cacheCtx, cacheKey); err == nil {
						var cached ListByFollowingResponse
						if err := json.Unmarshal(b, &cached); err == nil {
							return cached, nil
						}
					}
				}
			}
		}
	}

	resp, err := doListByFollowingFromDB()
	if err != nil {
		return ListByFollowingResponse{}, err
	}
	if cacheKey != "" {
		if b, err := json.Marshal(resp); err == nil {
			cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
			defer cancel()
			_ = f.rediscache.SetBytes(cacheCtx, cacheKey, b, f.cacheTTL)
		}
	}
	return resp, nil
}

func (f *FeedService) ListByPopularity(ctx context.Context, limit int, reqAsOf int64, offset int, viewerAccountID uint, latestPopularity int64, latestBefore time.Time, latestIDBefore uint) (ListByPopularityResponse, error) {
	localCacheKey := ""
	if viewerAccountID == 0 && reqAsOf == 0 && offset == 0 && latestPopularity == 0 && latestBefore.IsZero() && latestIDBefore == 0 && f.localcache != nil {
		localCacheKey = fmt.Sprintf("feed:listByPopularity:anon:first:limit=%d", limit)
		if cached, ok := f.localcache.Get(localCacheKey); ok {
			if resp, ok := cached.(ListByPopularityResponse); ok {
				return resp, nil
			}
		}
	}
	// Redis 热榜（稳定分页：as_of + offset）
	if f.rediscache != nil {
		asOf := time.Now().UTC().Truncate(time.Minute)
		if reqAsOf > 0 {
			asOf = time.Unix(reqAsOf, 0).UTC().Truncate(time.Minute)
		}

		const win = 60
		keys := make([]string, 0, win)
		for i := 0; i < win; i++ {
			keys = append(keys, f.rediscache.Key("hot:video:1m:%s", asOf.Add(-time.Duration(i)*time.Minute).Format("200601021504")))
		}

		dest := f.rediscache.Key("hot:video:merge:1m:%s", asOf.Format("200601021504")) // 快照key：同一个as_of页内复用
		opCtx, cancel := context.WithTimeout(ctx, 80*time.Millisecond)
		defer cancel()

		exists, _ := f.rediscache.Exists(opCtx, dest)
		if !exists {
			_ = f.rediscache.ZUnionStore(opCtx, dest, keys, "SUM")
			_ = f.rediscache.Expire(opCtx, dest, 2*time.Minute) // 给翻页留时间
		}

		start := int64(offset)
		stop := start + int64(limit) - 1
		members, err := f.rediscache.ZRevRange(opCtx, dest, start, stop)
		if err == nil && len(members) == 0 {
			if offset > 0 {
				return ListByPopularityResponse{
					VideoList:  []FeedVideoItem{},
					AsOf:       asOf.Unix(),
					NextOffset: offset,
					HasMore:    false,
				}, nil
			}
		}
		if err == nil && len(members) > 0 {
			ids := make([]uint, 0, len(members))
			for _, m := range members {
				u, err := strconv.ParseUint(m, 10, 64)
				if err == nil && u > 0 {
					ids = append(ids, uint(u))
				}
			}

			items, err := f.GetFeedItemsByIDs(ctx, ids, viewerAccountID)
			if err == nil {
				resp := ListByPopularityResponse{
					VideoList:  items,
					AsOf:       asOf.Unix(),
					NextOffset: offset + len(items),
					HasMore:    len(items) == limit,
				}
				if len(items) > 0 {
					lastReadModel, ok := f.getFeedReadModel(ctx, items[len(items)-1].ID)
					if ok {
						nextPopularity := lastReadModel.Popularity
						nextBefore := time.UnixMilli(lastReadModel.SortCreateTimeMS)
						nextID := lastReadModel.ID
						resp.NextLatestPopularity = &nextPopularity
						resp.NextLatestBefore = &nextBefore
						resp.NextLatestIDBefore = &nextID
					}
				}
				if localCacheKey != "" {
					f.localcache.Set(localCacheKey, resp, hotReadLocalTTL)
				}
				return resp, nil
			}
		}
	}

	videos, err := f.repo.ListByPopularity(ctx, limit, latestPopularity, latestBefore, latestIDBefore)
	if err != nil {
		return ListByPopularityResponse{}, err
	}
	items, err := f.buildFeedVideos(ctx, videos, viewerAccountID)
	if err != nil {
		return ListByPopularityResponse{}, err
	}
	resp := ListByPopularityResponse{
		VideoList:  items,
		AsOf:       0,
		NextOffset: 0,
		HasMore:    len(items) == limit,
	}
	if len(videos) > 0 {
		last := videos[len(videos)-1]
		nextPopularity := last.Popularity
		nextBefore := last.CreateTime
		nextID := last.ID
		resp.NextLatestPopularity = &nextPopularity
		resp.NextLatestBefore = &nextBefore
		resp.NextLatestIDBefore = &nextID
	}
	if localCacheKey != "" {
		f.localcache.Set(localCacheKey, resp, hotReadLocalTTL)
	}
	return resp, nil
}

func (f *FeedService) buildFeedVideos(ctx context.Context, videos []*video.Video, viewerAccountID uint) ([]FeedVideoItem, error) {
	feedVideos := make([]FeedVideoItem, 0, len(videos))
	videoIDs := make([]uint, len(videos))
	for i, v := range videos {
		videoIDs[i] = v.ID
	}
	likedMap, err := f.likeRepo.BatchGetLiked(ctx, videoIDs, viewerAccountID)
	if err != nil {
		return nil, err
	}
	for _, video := range videos {
		readItem := readmodel.NewFeedVideoItem(video.ID, video.AuthorID, video.Username, video.Title, video.Description, video.PlayURL, video.CoverURL, video.CreateTime, video.LikesCount, video.Popularity)
		item := feedItemFromReadModel(readItem)
		item.IsLiked = likedMap[video.ID]
		feedVideos = append(feedVideos, item)
		f.setFeedReadModel(ctx, readItem)
	}
	return feedVideos, nil
}

func buildOrderedResult(orderedIDs []uint, dataMap map[uint]*video.Video) []*video.Video {
	res := make([]*video.Video, 0, len(orderedIDs))
	for _, id := range orderedIDs {
		if v, exits := dataMap[id]; exits && v != nil {
			res = append(res, v)
		}
	}
	return res
}

func joinUintIDs(ids []uint) string {
	if len(ids) == 0 {
		return ""
	}
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, strconv.FormatUint(uint64(id), 10))
	}
	return strings.Join(parts, ",")
}

func (f *FeedService) ListByTag(ctx context.Context, tagName string, limit int, viewerAccountID uint) ([]FeedVideoItem, error) {
	videos, err := f.repo.ListByTag(ctx, tagName, limit)
	if err != nil {
		return nil, err
	}
	return f.buildFeedVideos(ctx, videos, viewerAccountID)
}

func (f *FeedService) GetFeedItemsByIDs(ctx context.Context, ids []uint, viewerAccountID uint) ([]FeedVideoItem, error) {
	if len(ids) == 0 {
		return []FeedVideoItem{}, nil
	}

	itemMap := make(map[uint]readmodel.FeedVideoItem, len(ids))
	missed := make([]uint, 0, len(ids))
	for _, id := range ids {
		cacheKey := f.feedItemCacheKey(id)
		if f.localcache != nil {
			if cached, found := f.localcache.Get(cacheKey); found {
				if item, ok := cached.(readmodel.FeedVideoItem); ok {
					itemMap[id] = item
					continue
				}
			}
		}
		missed = append(missed, id)
	}

	if len(missed) > 0 && f.rediscache != nil {
		cacheKeys := make([]string, len(missed))
		for i, id := range missed {
			cacheKeys[i] = f.feedItemCacheKey(id)
		}
		cacheCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
		results, err := f.rediscache.MGet(cacheCtx, cacheKeys...)
		cancel()
		if err == nil {
			nextMissed := make([]uint, 0, len(missed))
			for i, res := range results {
				id := missed[i]
				if res != nil {
					if str, ok := res.(string); ok {
						var item readmodel.FeedVideoItem
						if err := json.Unmarshal([]byte(str), &item); err == nil {
							itemMap[id] = item
							if f.localcache != nil {
								f.localcache.Set(cacheKeys[i], item, 5*time.Second)
							}
							continue
						}
					}
				}
				nextMissed = append(nextMissed, id)
			}
			missed = nextMissed
		}
	}

	if len(missed) > 0 {
		videos, err := f.GetVideoByIDs(ctx, missed)
		if err != nil {
			return nil, err
		}
		for _, v := range videos {
			if v == nil {
				continue
			}
			item := readmodel.NewFeedVideoItem(v.ID, v.AuthorID, v.Username, v.Title, v.Description, v.PlayURL, v.CoverURL, v.CreateTime, v.LikesCount, v.Popularity)
			itemMap[v.ID] = item
			f.setFeedReadModel(ctx, item)
		}
	}

	likedMap, err := f.likeRepo.BatchGetLiked(ctx, ids, viewerAccountID)
	if err != nil {
		return nil, err
	}

	items := make([]FeedVideoItem, 0, len(ids))
	for _, id := range ids {
		item, ok := itemMap[id]
		if !ok {
			continue
		}
		resp := feedItemFromReadModel(item)
		resp.IsLiked = likedMap[id]
		items = append(items, resp)
	}
	return items, nil
}

func (f *FeedService) setFeedReadModel(ctx context.Context, item readmodel.FeedVideoItem) {
	cacheKey := f.feedItemCacheKey(item.ID)
	if f.localcache != nil {
		f.localcache.Set(cacheKey, item, 5*time.Second)
	}
	if f.rediscache == nil {
		return
	}
	go func(item readmodel.FeedVideoItem) {
		setCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
		defer cancel()
		_ = readmodel.SaveFeedVideoItem(setCtx, f.rediscache, item, readmodel.FeedVideoItemTTL)
	}(item)
}

func (f *FeedService) getFeedReadModel(ctx context.Context, id uint) (readmodel.FeedVideoItem, bool) {
	cacheKey := f.feedItemCacheKey(id)
	if f.localcache != nil {
		if cached, found := f.localcache.Get(cacheKey); found {
			if item, ok := cached.(readmodel.FeedVideoItem); ok {
				return item, true
			}
		}
	}
	if f.rediscache == nil {
		return readmodel.FeedVideoItem{}, false
	}
	cacheCtx, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	item, ok, err := readmodel.LoadFeedVideoItem(cacheCtx, f.rediscache, id)
	if err != nil || !ok {
		return readmodel.FeedVideoItem{}, false
	}
	if f.localcache != nil {
		f.localcache.Set(cacheKey, item, 5*time.Second)
	}
	return item, true
}

func (f *FeedService) feedItemCacheKey(id uint) string {
	if f.rediscache != nil {
		return readmodel.FeedVideoItemKey(f.rediscache, id)
	}
	return fmt.Sprintf("feed:item:%d", id)
}

func feedItemFromReadModel(item readmodel.FeedVideoItem) FeedVideoItem {
	return FeedVideoItem{
		ID:          item.ID,
		Author:      FeedAuthor{ID: item.Author.ID, Username: item.Author.Username},
		Title:       item.Title,
		Description: item.Description,
		PlayURL:     item.PlayURL,
		CoverURL:    item.CoverURL,
		CreateTime:  item.CreateTime,
		LikesCount:  item.LikesCount,
		IsLiked:     item.IsLiked,
	}
}
