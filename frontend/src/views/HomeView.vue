<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppShell from '../components/AppShell.vue'
import FeedVideoCard from '../components/FeedVideoCard.vue'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'
import { useVideoFeed } from '../composables/useVideoFeed'
import { useLikeFollow } from '../composables/useLikeFollow'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const { tab, following, currentState, loadFollowing, loadRecommend, loadHot, ensureTabLoaded } = useVideoFeed()

async function needLogin() {
  toast.error('请先登录')
  await router.push('/account')
}

const { likeBusy, toggleLike } = useLikeFollow(needLogin)

const q = computed(() => (typeof route.query.q === 'string' ? route.query.q.trim().toLowerCase() : ''))
const filteredItems = computed(() => {
  const items = currentState.value.items
  if (!q.value) return items
  return items.filter((v) =>
    [v.title, v.description || '', v.author.username].some((part) => part.toLowerCase().includes(q.value)),
  )
})

const tabCopy = computed(() => {
  if (tab.value === 'following') return '看看你关注的人最近都在发什么图文内容。'
  if (tab.value === 'hot') return '按热度排序，适合展示“爆款图文内容”的效果。'
  return '推荐流已经从短视频风格切成图文笔记瀑布流，更适合面试时演示小红书式社区产品。'
})

async function refreshCurrentTab() {
  if (tab.value === 'recommend') await loadRecommend(true)
  else if (tab.value === 'hot') await loadHot(true)
  else await loadFollowing(true)
}

async function loadMoreCurrentTab() {
  if (tab.value === 'recommend') await loadRecommend(false)
  else if (tab.value === 'hot') await loadHot(false)
  else await loadFollowing(false)
}

watch(() => auth.isLoggedIn, async (v) => {
  if (tab.value === 'following' && v && following.items.length === 0) await loadFollowing(true)
})

watch(() => tab.value, async () => {
  await ensureTabLoaded()
})

onMounted(async () => {
  await ensureTabLoaded()
})
</script>

<template>
  <AppShell full>
    <div class="page">
      <section class="hero">
        <div>
          <div class="hero-kicker">图文社区 Demo</div>
          <h1 class="hero-title">把原来的短视频流，快速改成了小红书风格的图文瀑布流</h1>
          <p class="hero-copy">{{ tabCopy }}</p>
        </div>
        <div class="hero-tabs">
          <button class="tab" :class="{ on: tab === 'recommend' }" type="button" @click="tab = 'recommend'">推荐</button>
          <button class="tab" :class="{ on: tab === 'following' }" type="button" @click="tab = 'following'">关注</button>
          <button class="tab" :class="{ on: tab === 'hot' }" type="button" @click="tab = 'hot'">热榜</button>
        </div>
      </section>

      <section class="stream-head">
        <div class="subtle">
          当前共 {{ filteredItems.length }} 条{{ q ? '匹配到的' : '' }}笔记
          <span v-if="q"> · 搜索词：{{ q }}</span>
        </div>
        <div class="row">
          <button class="chip-btn" type="button" :disabled="currentState.loading" @click="refreshCurrentTab">刷新</button>
          <button class="chip-btn primary" type="button" :disabled="currentState.loading || !currentState.hasMore" @click="loadMoreCurrentTab">
            加载更多
          </button>
        </div>
      </section>

      <div v-if="currentState.loading && currentState.items.length === 0" class="center-hint">加载中…</div>
      <div v-else-if="currentState.error && currentState.items.length === 0" class="center-hint bad">{{ currentState.error }}</div>
      <div v-else-if="filteredItems.length === 0" class="center-hint">没有匹配内容</div>

      <section v-else class="waterfall">
        <FeedVideoCard
          v-for="item in filteredItems"
          :key="`${tab}-${item.id}`"
          :item="item"
          :can-like="auth.isLoggedIn"
          :busy="!!likeBusy[String(item.id)]"
          @toggle-like="toggleLike"
        />
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.page {
  min-height: 100%;
  padding: 20px 18px 36px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: end;
  padding: 24px;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background:
    radial-gradient(circle at top right, rgba(255, 166, 138, 0.22), transparent 26%),
    radial-gradient(circle at top left, rgba(97, 194, 255, 0.2), transparent 22%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.03));
}

.hero-kicker {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.62);
}

.hero-title {
  margin: 8px 0 10px;
  font-size: clamp(26px, 4vw, 40px);
  line-height: 1.05;
}

.hero-copy {
  margin: 0;
  max-width: 680px;
  color: rgba(255, 255, 255, 0.76);
  line-height: 1.6;
}

.hero-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.tab,
.chip-btn {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
}

.tab.on,
.chip-btn.primary {
  border-color: rgba(255, 120, 90, 0.48);
  background: rgba(255, 120, 90, 0.16);
}

.stream-head {
  margin: 18px 0 14px;
  display: flex;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
}

.center-hint {
  min-height: 280px;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.78);
}

.center-hint.bad {
  color: rgba(255, 120, 90, 0.96);
}

.waterfall {
  column-count: 3;
  column-gap: 16px;
}

.waterfall :deep(.feed-card) {
  margin-bottom: 16px;
}

@media (max-width: 1000px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .hero-tabs {
    justify-content: flex-start;
  }

  .waterfall {
    column-count: 2;
  }
}

@media (max-width: 720px) {
  .page {
    padding: 14px 12px 28px;
  }

  .stream-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .waterfall {
    column-count: 1;
  }
}
</style>
