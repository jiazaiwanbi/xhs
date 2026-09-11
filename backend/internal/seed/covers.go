package seed

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	seedCoversDir       = ".run/uploads/seed/covers"
	seedCoversPublicURL = "/static/seed/covers"
	maxCoverBytes       = 5 << 20
	coverWorkers        = 12
)

type coverDownload struct {
	index int
	id    string
}

func prepareCoverURLs(ctx context.Context, count int) []string {
	urls := make([]string, count)
	if count == 0 {
		return urls
	}
	if err := os.MkdirAll(seedCoversDir, 0o755); err != nil {
		log.Printf("seed covers: cannot create local directory, using remote URLs: %v", err)
		for i := range urls {
			urls[i] = remoteCoverURL(coverAssetIDs[i])
		}
		return urls
	}

	jobs := make(chan coverDownload)
	var wg sync.WaitGroup
	var mu sync.Mutex
	downloaded, cached, fallback := 0, 0, 0
	client := &http.Client{Timeout: 30 * time.Second}

	worker := func() {
		defer wg.Done()
		for job := range jobs {
			filename := fmt.Sprintf("picsum-%s.webp", job.id)
			localPath := filepath.Join(seedCoversDir, filename)
			publicURL := path.Join(seedCoversPublicURL, filename)
			if isValidWebP(localPath) {
				urls[job.index] = publicURL
				mu.Lock()
				cached++
				mu.Unlock()
				continue
			}

			err := downloadCover(ctx, client, remoteCoverURL(job.id), localPath)
			mu.Lock()
			if err != nil {
				urls[job.index] = remoteCoverURL(job.id)
				fallback++
				log.Printf("seed covers: image id=%s download failed, using remote URL: %v", job.id, err)
			} else {
				urls[job.index] = publicURL
				downloaded++
			}
			mu.Unlock()
		}
	}

	workers := min(coverWorkers, count)
	for range workers {
		wg.Add(1)
		go worker()
	}
	for i := 0; i < count; i++ {
		jobs <- coverDownload{index: i, id: coverAssetIDs[i]}
	}
	close(jobs)
	wg.Wait()
	log.Printf("seed covers ready: downloaded=%d cached=%d remote_fallback=%d", downloaded, cached, fallback)
	return urls
}

func remoteCoverURL(id string) string {
	return fmt.Sprintf("https://picsum.photos/id/%s/800/1000.webp", id)
}

func downloadCover(ctx context.Context, client *http.Client, sourceURL, destination string) error {
	var lastErr error
	for attempt := 1; attempt <= 2; attempt++ {
		if err := downloadCoverOnce(ctx, client, sourceURL, destination); err == nil {
			return nil
		} else {
			lastErr = err
		}
	}
	return lastErr
}

func downloadCoverOnce(ctx context.Context, client *http.Client, sourceURL, destination string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "feedsystem-seed/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected HTTP status %s", resp.Status)
	}
	if contentType := resp.Header.Get("Content-Type"); contentType != "" && !strings.HasPrefix(contentType, "image/webp") {
		return fmt.Errorf("unexpected content type %q", contentType)
	}

	tmp, err := os.CreateTemp(filepath.Dir(destination), ".cover-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	written, copyErr := io.Copy(tmp, io.LimitReader(resp.Body, maxCoverBytes+1))
	closeErr := tmp.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written == 0 || written > maxCoverBytes {
		return fmt.Errorf("invalid image size %d", written)
	}
	if !isValidWebP(tmpName) {
		return errors.New("response is not a valid WebP image")
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpName, destination)
}

func isValidWebP(filename string) bool {
	f, err := os.Open(filename)
	if err != nil {
		return false
	}
	defer f.Close()
	header := make([]byte, 12)
	if _, err := io.ReadFull(f, header); err != nil {
		return false
	}
	return string(header[:4]) == "RIFF" && string(header[8:]) == "WEBP"
}
