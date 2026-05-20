<script setup lang="ts">
import type { FeedVideoItem } from '../api/types'

const props = defineProps<{
  item: FeedVideoItem
  canLike: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle-like', item: FeedVideoItem): void
}>()

function onToggle() {
  emit('toggle-like', props.item)
}
</script>

<template>
  <div class="feed-card">
    <RouterLink class="cover" :to="`/video/${item.id}`" :aria-label="`查看笔记：${item.title}`">
      <img :src="item.cover_url" :alt="item.title" loading="lazy" />
    </RouterLink>
    <div class="content">
      <div class="row" style="justify-content: space-between">
        <div>
          <div class="title">
            <RouterLink :to="`/video/${item.id}`">{{ item.title }}</RouterLink>
          </div>
          <div class="subtle">
            @{{ item.author.username }} · #{{ item.author.id }} · {{ new Date(item.create_time * 1000).toLocaleString() }}
          </div>
        </div>
        <div class="row">
          <span class="pill mono">❤️ {{ item.likes_count }}</span>
          <button
            v-if="canLike"
            class="primary"
            type="button"
            :disabled="busy"
            @click="onToggle"
            :title="item.is_liked ? '取消点赞' : '点赞'"
          >
            {{ item.is_liked ? '已赞' : '点赞' }}
          </button>
        </div>
      </div>
      <div v-if="item.description" class="note-copy">{{ item.description }}</div>
      <div class="row" style="margin-top: 12px">
        <a class="pill mono" :href="item.cover_url || item.play_url" target="_blank" rel="noreferrer">原图</a>
        <RouterLink class="pill" :to="`/video/${item.id}`">查看笔记 / 评论</RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.feed-card {
  display: grid;
  gap: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 16px;
  overflow: hidden;
  break-inside: avoid;
}

.cover {
  display: block;
  background: rgba(0, 0, 0, 0.25);
  aspect-ratio: 4/5;
  color: inherit;
  text-decoration: none;
}

.cover:hover img {
  transform: scale(1.02);
}

.cover:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.8);
  outline-offset: -2px;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
  transition: transform 0.18s ease;
}

.title a {
  color: inherit;
  text-decoration: none;
}

.title a:hover {
  text-decoration: underline;
}

.content {
  padding: 12px 12px 14px;
}

.note-copy {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
