package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"feedsystem_video_go/internal/config"
	"feedsystem_video_go/internal/db"
	rediscache "feedsystem_video_go/internal/middleware/redis"
	"feedsystem_video_go/internal/seed"

	"github.com/joho/godotenv"
)

func main() {
	var opts seed.Options
	flag.IntVar(&opts.Users, "users", 100, "number of deterministic test users")
	flag.IntVar(&opts.Videos, "videos", 300, "number of deterministic test videos")
	flag.IntVar(&opts.Likes, "likes", 2000, "number of deterministic likes")
	flag.IntVar(&opts.Comments, "comments", 500, "number of deterministic comments")
	flag.IntVar(&opts.Follows, "follows", 800, "number of deterministic follow relationships")
	flag.Parse()

	_ = godotenv.Load()
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "configs/config.yaml"
	}
	cfg, _, err := config.LoadLocalDev(configPath)
	if err != nil {
		log.Fatalf("load config: %v", err)
	}
	database, err := db.NewDB(cfg.Database)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer db.CloseDB(database)
	if err := db.AutoMigrate(database); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	cache, err := rediscache.NewFromEnv(&cfg.Redis)
	if err != nil {
		log.Fatalf("configure Redis: %v", err)
	}
	defer cache.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := cache.Ping(ctx); err != nil {
		log.Fatalf("connect Redis: %v", err)
	}

	result, err := seed.Run(ctx, database, cache, opts)
	if err != nil {
		log.Fatalf("seed failed: %v", err)
	}
	fmt.Printf("seeded users=%d videos=%d likes=%d comments=%d follows=%d password=%s\n",
		result.Users, result.Videos, result.Likes, result.Comments, result.Follows, seed.DefaultPassword)
}
