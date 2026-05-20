<script setup lang="ts">
import { computed, onMounted, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppShell from '../components/AppShell.vue'
import UserAvatar from '../components/UserAvatar.vue'
import { ApiError } from '../api/client'
import * as commentApi from '../api/comment'
import * as likeApi from '../api/like'
import type { Comment, Video } from '../api/types'
import * as videoApi from '../api/video'
import { useAuthStore } from '../stores/auth'
import { useSocialStore } from '../stores/social'
import { useToastStore } from '../stores/toast'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const social = useSocialStore()
const toast = useToastStore()

const id = computed(() => Number(route.params.id))

const state = reactive({
  loading: false,
  error: '',
  video: null as Video | null,
  isLiked: null as boolean | null,
  busy: false,
})

const comments = reactive({
  loading: false,
  error: '',
  list: [] as Comment[],
  content: '',
})

async function needLogin() {
  toast.error('请先登录')
  await router.push('/account')
}

async function loadVideo() {
  if (!Number.isFinite(id.value) || id.value <= 0) {
    state.error = '无效的笔记 id'
    return
  }
  state.loading = true
  state.error = ''
  try {
    state.video = await videoApi.getDetail(id.value)
  } catch (e) {
    state.error = e instanceof ApiError ? e.message : String(e)
  } finally {
    state.loading = false
  }
}

async function loadIsLiked() {
  if (!auth.isLoggedIn) {
    state.isLiked = null
    return
  }
  try {
    const res = await likeApi.isLiked(id.value)
    state.isLiked = res.is_liked
  } catch {
    state.isLiked = null
  }
}

async function loadComments() {
  if (!state.video) return
  comments.loading = true
  comments.error = ''
  try {
    comments.list = await commentApi.listAll(state.video.id)
  } catch (e) {
    comments.error = e instanceof ApiError ? e.message : String(e)
  } finally {
    comments.loading = false
  }
}

async function toggleLike() {
  if (!state.video) return
  if (!auth.isLoggedIn) return needLogin()
  if (state.busy) return

  state.busy = true
  try {
    if (state.isLiked) {
      await likeApi.unlike(id.value)
      state.isLiked = false
      state.video.likes_count = Math.max(0, state.video.likes_count - 1)
    } else {
      await likeApi.like(id.value)
      state.isLiked = true
      state.video.likes_count += 1
    }
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String(e)
    toast.error(msg)
  } finally {
    state.busy = false
  }
}

async function toggleFollow() {
  if (!state.video) return
  if (!auth.isLoggedIn) return needLogin()
  if (state.busy) return
  if (auth.claims?.account_id && auth.claims.account_id === state.video.author_id) return

  state.busy = true
  try {
    if (social.isFollowing(state.video.author_id)) {
      await social.unfollow(state.video.author_id)
      toast.info('已取关')
    } else {
      await social.follow(state.video.author_id)
      toast.success('已关注')
    }
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String(e)
    toast.error(msg)
  } finally {
    state.busy = false
  }
}

async function share() {
  if (!state.video) return
  const url = `${location.origin}/video/${state.video.id}`
  try {
    await navigator.clipboard.writeText(url)
    toast.success('链接已复制')
  } catch {
    window.prompt('复制链接', url)
  }
}

async function publishComment() {
  if (!state.video) return
  if (!auth.isLoggedIn) return needLogin()
  const content = comments.content.trim()
  if (!content) return

  comments.loading = true
  comments.error = ''
  try {
    await commentApi.publish(state.video.id, content)
    comments.content = ''
    await loadComments()
    toast.success('评论已发布')
  } catch (e) {
    comments.error = e instanceof ApiError ? e.message : String(e)
    toast.error(comments.error)
  } finally {
    comments.loading = false
  }
}

function canDeleteComment(c: Comment) {
  const myId = auth.claims?.account_id
  return !!myId && myId === c.author_id
}

async function deleteComment(commentId: number) {
  if (!auth.isLoggedIn) return needLogin()
  if (!window.confirm('确认删除这条评论？')) return

  comments.loading = true
  comments.error = ''
  try {
    await commentApi.remove(commentId)
    await loadComments()
    toast.info('评论已删除')
  } catch (e) {
    comments.error = e instanceof ApiError ? e.message : String(e)
    toast.error(comments.error)
  } finally {
    comments.loading = false
  }
}

watch(
  () => id.value,
  async () => {
    await loadVideo()
    await loadIsLiked()
    await loadComments()
  },
)

watch(
  () => auth.isLoggedIn,
  async () => {
    await loadIsLiked()
  },
)

onMounted(async () => {
  await loadVideo()
  await loadIsLiked()
  await loadComments()
})
</script>

<template>
  <AppShell full>
    <div class="page">
      <div class="top">
        <RouterLink class="chip" to="/">← 返回推荐</RouterLink>
      </div>

      <div class="wrap">
        <div v-if="state.loading" class="center-hint">加载中…</div>
        <div v-else-if="state.error" class="center-hint bad">{{ state.error }}</div>

        <div v-else-if="state.video" class="note-shell">
          <div class="note-cover-wrap">
            <img class="note-cover" :src="state.video.cover_url || state.video.play_url" :alt="state.video.title" />
          </div>

          <div class="note-main">
            <RouterLink class="author-link" :to="`/u/${state.video.author_id}`">
              <UserAvatar :username="state.video.username" :id="state.video.author_id" :size="34" />
              <span class="author-name">@{{ state.video.username }}</span>
              <span class="publish-time">{{ new Date(state.video.create_time).toLocaleString() }}</span>
            </RouterLink>

            <h1 class="title">{{ state.video.title }}</h1>
            <div v-if="state.video.description" class="desc">{{ state.video.description }}</div>

            <div class="row meta-row">
              <a class="chip mono" :href="state.video.cover_url || state.video.play_url" target="_blank" rel="noreferrer">查看原图</a>
              <span class="chip mono">ID {{ state.video.id }}</span>
            </div>

            <div class="actions">
              <button class="act" type="button" :disabled="state.busy" @click="toggleLike">
                <span class="icon" :class="{ liked: !!state.isLiked }">♥</span>
                <span class="count">{{ state.video.likes_count }}</span>
              </button>

              <button
                v-if="!auth.claims?.account_id || auth.claims.account_id !== state.video.author_id"
                class="act"
                type="button"
                :disabled="state.busy"
                @click="toggleFollow"
              >
                <span class="icon">＋</span>
                <span class="count">{{ social.isFollowing(state.video.author_id) ? '已关注' : '关注' }}</span>
              </button>

              <button class="act" type="button" @click="share">
                <span class="icon">↗</span>
                <span class="count">分享</span>
              </button>
            </div>
          </div>

          <div class="note-side">
            <div class="side-card">
              <div class="side-title">评论区</div>

              <div class="comment-compose">
                <textarea v-model="comments.content" placeholder="写下你的想法…" :disabled="comments.loading" />
                <div class="row" style="justify-content: space-between; margin-top: 8px">
                  <button class="chip" type="button" :disabled="comments.loading" @click="loadComments">刷新</button>
                  <button class="chip primary" type="button" :disabled="comments.loading || !comments.content.trim()" @click="publishComment">
                    发送
                  </button>
                </div>
              </div>

              <div v-if="comments.loading" class="drawer-hint">加载中…</div>
              <div v-else-if="comments.error" class="drawer-hint bad">{{ comments.error }}</div>
              <div v-else-if="comments.list.length === 0" class="drawer-hint">暂无评论</div>

              <div class="comment" v-for="c in comments.list" :key="c.id">
                <div class="comment-top">
                  <div class="comment-user">{{ c.username }}</div>
                  <div class="comment-meta mono">#{{ c.id }} · {{ new Date(c.created_at).toLocaleString() }}</div>
                </div>
                <div class="comment-content">{{ c.content }}</div>
                <div class="comment-actions">
                  <button v-if="canDeleteComment(c)" class="chip danger" type="button" :disabled="comments.loading" @click="deleteComment(c.id)">
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.page {
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.top {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.25);
  backdrop-filter: blur(16px);
}

.wrap {
  flex: 1;
  min-height: 0;
  display: block;
  padding: 18px 14px 30px;
}

.center-hint {
  color: rgba(255, 255, 255, 0.78);
}

.center-hint.bad {
  color: rgba(255, 120, 90, 0.92);
}

.note-shell {
  width: min(1120px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
  gap: 22px;
  align-items: start;
}

.note-cover-wrap,
.note-main,
.side-card {
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
}

.note-cover-wrap {
  position: sticky;
  top: 12px;
}

.note-cover {
  width: 100%;
  display: block;
  aspect-ratio: 4 / 5;
  object-fit: cover;
}

.note-main,
.side-card {
  padding: 18px;
}

.author-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex-wrap: wrap;
}

.publish-time {
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
}

.title {
  font-size: clamp(24px, 3.6vw, 38px);
  line-height: 1.08;
  margin: 14px 0 10px;
}

.desc {
  color: rgba(255, 255, 255, 0.8);
  font-size: 15px;
  line-height: 1.75;
  white-space: pre-wrap;
}

.meta-row {
  margin-top: 16px;
  flex-wrap: wrap;
}

.actions {
  margin-top: 18px;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.act {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.18);
  color: rgba(255, 255, 255, 0.92);
  padding: 12px 16px;
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.act:hover {
  background: rgba(255, 255, 255, 0.1);
}

.act:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.icon {
  font-size: 20px;
  line-height: 1;
  opacity: 0.92;
}

.icon.liked {
  color: rgba(254, 44, 85, 1);
  text-shadow: 0 10px 20px rgba(254, 44, 85, 0.25);
}

.count {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.82);
}

.side-title {
  font-weight: 800;
  margin-bottom: 10px;
}

.comment-compose textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 110px;
  resize: vertical;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  padding: 12px 14px;
}

.drawer-hint {
  color: rgba(255, 255, 255, 0.72);
  margin-top: 14px;
}

.drawer-hint.bad {
  color: rgba(255, 120, 90, 0.96);
}

.comment {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.comment-top {
  display: flex;
  gap: 10px;
  justify-content: space-between;
  align-items: baseline;
}

.comment-user {
  font-weight: 700;
}

.comment-meta {
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
}

.comment-content {
  margin-top: 8px;
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.6;
}

.comment-actions {
  margin-top: 10px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.86);
  font-size: 12px;
  text-decoration: none;
}

.chip.primary {
  border-color: rgba(254, 44, 85, 0.45);
  background: rgba(254, 44, 85, 0.14);
}

.chip.danger {
  border-color: rgba(254, 44, 85, 0.55);
  background: rgba(254, 44, 85, 0.12);
}

@media (max-width: 900px) {
  .wrap {
    padding: 14px 12px 24px;
  }

  .note-shell {
    grid-template-columns: 1fr;
    gap: 14px;
  }

  .note-cover-wrap {
    position: static;
  }

  .note-cover {
    aspect-ratio: 4 / 3;
    max-height: 46vh;
  }

  .note-main,
  .side-card {
    padding: 14px;
    border-radius: 18px;
  }

  .title {
    font-size: 22px;
    line-height: 1.18;
    margin: 10px 0 8px;
  }

  .desc {
    font-size: 14px;
    line-height: 1.6;
  }

  .actions {
    margin-top: 14px;
    gap: 10px;
  }

  .act {
    padding: 10px 14px;
  }
}
</style>
