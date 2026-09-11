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
		{name: "defaults", opts: Options{Users: 100, Videos: 300, Images: 240, Likes: 2000, Comments: 500, Follows: 800}},
		{name: "all zero", opts: Options{}},
		{name: "negative", opts: Options{Users: -1}, wantErr: true},
		{name: "video without user", opts: Options{Videos: 1}, wantErr: true},
		{name: "like without video", opts: Options{Users: 1, Likes: 1}, wantErr: true},
		{name: "too many likes", opts: Options{Users: 2, Videos: 2, Likes: 5}, wantErr: true},
		{name: "too many images", opts: Options{Users: 2, Videos: 2, Images: 3}, wantErr: true},
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
	keys := seedKeys(2)
	if keys[0] != "note-0001" || keys[1] != "note-0002" {
		t.Fatalf("unexpected seed keys: %v", keys)
	}
}

func TestSeedTitlesAreUniqueForDefaultMix(t *testing.T) {
	seen := make(map[string]struct{}, 300)
	for i := 1; i <= 300; i++ {
		isImage := isSeedImageNote(i, 300, 240)
		title := buildSeedTitle(seedContentTypeOrdinal(i, 300, 240, isImage), isImage)
		if _, exists := seen[title]; exists {
			t.Fatalf("duplicate title %q at index %d", title, i)
		}
		seen[title] = struct{}{}
	}
}

func TestSeedImageNotesAreEvenlyDistributed(t *testing.T) {
	images := 0
	videosInLastTen := 0
	for i := 1; i <= 300; i++ {
		if isSeedImageNote(i, 300, 240) {
			images++
		} else if i > 290 {
			videosInLastTen++
		}
	}
	if images != 240 {
		t.Fatalf("image count = %d, want 240", images)
	}
	if videosInLastTen == 0 || videosInLastTen == 10 {
		t.Fatalf("latest ten notes are not mixed, video count = %d", videosInLastTen)
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
