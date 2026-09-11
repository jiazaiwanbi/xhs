package seed

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOptionsValidate(t *testing.T) {
	tests := []struct {
		name    string
		opts    Options
		wantErr bool
	}{
		{name: "defaults", opts: Options{Users: 100, Videos: 300, Likes: 2000, Comments: 500, Follows: 800}},
		{name: "all zero", opts: Options{}},
		{name: "negative", opts: Options{Users: -1}, wantErr: true},
		{name: "video without user", opts: Options{Videos: 1}, wantErr: true},
		{name: "like without video", opts: Options{Users: 1, Likes: 1}, wantErr: true},
		{name: "too many likes", opts: Options{Users: 2, Videos: 2, Likes: 5}, wantErr: true},
		{name: "self follow excluded", opts: Options{Users: 1, Follows: 1}, wantErr: true},
		{name: "maximum relationships", opts: Options{Users: 3, Videos: 2, Likes: 6, Follows: 6}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.opts.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestSeedNaturalKeysAreStable(t *testing.T) {
	users := seedUsernames(2)
	if users[0] != "user001" || users[1] != "user002" {
		t.Fatalf("unexpected usernames: %v", users)
	}
	titles := seedVideoTitles(2)
	if titles[0] != "[seed:0001] Feed 测试视频 0001" || titles[1] != "[seed:0002] Feed 测试视频 0002" {
		t.Fatalf("unexpected video titles: %v", titles)
	}
}

func TestCoverAssetIDsAreUnique(t *testing.T) {
	if len(coverAssetIDs) != 300 {
		t.Fatalf("expected 300 cover IDs, got %d", len(coverAssetIDs))
	}
	seen := make(map[string]struct{}, len(coverAssetIDs))
	for _, id := range coverAssetIDs {
		if _, exists := seen[id]; exists {
			t.Fatalf("duplicate cover ID %q", id)
		}
		seen[id] = struct{}{}
	}
}

func TestDownloadCoverOnceWritesValidatedWebP(t *testing.T) {
	webp := []byte("RIFF\x04\x00\x00\x00WEBPtest")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/webp")
		_, _ = w.Write(webp)
	}))
	defer server.Close()

	destination := filepath.Join(t.TempDir(), "cover.webp")
	if err := downloadCoverOnce(t.Context(), server.Client(), server.URL, destination); err != nil {
		t.Fatalf("downloadCoverOnce: %v", err)
	}
	if !isValidWebP(destination) {
		t.Fatal("downloaded cover did not pass WebP validation")
	}
	got, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(webp) {
		t.Fatalf("downloaded bytes = %q, want %q", got, webp)
	}
}
