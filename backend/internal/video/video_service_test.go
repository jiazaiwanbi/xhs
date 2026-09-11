package video

import "testing"

func TestNormalizePublishedContentImage(t *testing.T) {
	item := &Video{ContentType: ContentTypeImage, CoverURL: " cover.webp ", ImageURLs: []string{" image-1.webp ", "", "image-2.webp", "image-1.webp"}, PlayURL: "legacy.webp"}
	if err := normalizePublishedContent(item); err != nil {
		t.Fatalf("normalizePublishedContent: %v", err)
	}
	if item.PlayURL != "" || item.CoverURL != "image-1.webp" || len(item.ImageURLs) != 2 {
		t.Fatalf("unexpected normalized image note: %+v", item)
	}
}

func TestNormalizePublishedContentBackwardsCompatibleImage(t *testing.T) {
	item := &Video{PlayURL: "image.webp", CoverURL: "image.webp"}
	if err := normalizePublishedContent(item); err != nil {
		t.Fatalf("normalizePublishedContent: %v", err)
	}
	if item.ContentType != ContentTypeImage || len(item.ImageURLs) != 1 || item.PlayURL != "" {
		t.Fatalf("legacy image was not normalized: %+v", item)
	}
}

func TestNormalizePublishedContentRejectsInvalidType(t *testing.T) {
	item := &Video{ContentType: "audio", PlayURL: "audio.mp3", CoverURL: "cover.webp"}
	if err := normalizePublishedContent(item); err == nil {
		t.Fatal("expected invalid content type error")
	}
}
