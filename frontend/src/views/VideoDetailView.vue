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
      <div v-if="state.loading" class="center-hint">加载中…</div>
      <div v-else-if="state.error" class="center-hint bad">{{ state.error }}</div>

      <div v-else-if="state.video" class="note-reader">
        <section class="media-panel">
          <RouterLink class="back-link" to="/">← 返回最新</RouterLink>
          <img class="note-cover" :src="state.video.cover_url || state.video.play_url" :alt="state.video.title" />
        </section>

        <aside class="detail-panel">
          <section class="note-info">
            <div class="author-bar">
              <RouterLink class="author-link" :to="`/u/${state.video.author_id}`">
                <UserAvatar :username="state.video.username" :id="state.video.author_id" :size="44" />
                <span class="author-name">{{ state.video.username }}</span>
              </RouterLink>
              <button
                v-if="!auth.claims?.account_id || auth.claims.account_id !== state.video.author_id"
                class="follow-btn"
                type="button"
                :disabled="state.busy"
                @click="toggleFollow"
              >
                {{ social.isFollowing(state.video.author_id) ? '已关注' : '关注' }}
              </button>
            </div>

            <div class="note-copy">
              <h1 class="title">{{ state.video.title }}</h1>
              <p v-if="state.video.description" class="desc">{{ state.video.description }}</p>
              <div class="meta-line">
                <span>{{ new Date(state.video.create_time).toLocaleString() }}</span>
                <span>笔记 ID {{ state.video.id }}</span>
                <a :href="state.video.cover_url || state.video.play_url" target="_blank" rel="noreferrer">查看原图</a>
              </div>
            </div>
          </section>

          <section class="comment-panel">
            <div class="comment-title">
              <span>共 {{ comments.list.length }} 条评论</span>
              <button class="text-btn" type="button" :disabled="comments.loading" @click="loadComments">刷新</button>
            </div>

            <div class="comment-list">
              <div v-if="comments.loading" class="drawer-hint">加载中…</div>
              <div v-else-if="comments.error" class="drawer-hint bad">{{ comments.error }}</div>
              <div v-else-if="comments.list.length === 0" class="drawer-hint">暂无评论，来坐第一排。</div>

              <article class="comment" v-for="c in comments.list" :key="c.id">
                <UserAvatar :username="c.username" :id="c.author_id" :size="42" />
                <div class="comment-body">
                  <div class="comment-top">
                    <span class="comment-user">{{ c.username }}</span>
                    <button
                      v-if="canDeleteComment(c)"
                      class="more-btn danger"
                      type="button"
                      :disabled="comments.loading"
                      @click="deleteComment(c.id)"
                    >
                      删除
                    </button>
                  </div>
                  <div class="comment-content">{{ c.content }}</div>
                  <div class="comment-meta">{{ new Date(c.created_at).toLocaleString() }}</div>
                </div>
              </article>
            </div>
          </section>

          <footer class="action-bar">
            <div class="comment-input">
              <span class="spark">☼</span>
              <input
                v-model="comments.content"
                placeholder="说点什么..."
                :disabled="comments.loading"
                @keydown.enter.prevent="publishComment"
              />
              <button class="send-btn" type="button" :disabled="comments.loading || !comments.content.trim()" @click="publishComment">
                发送
              </button>
            </div>

            <div class="quick-actions">
              <button class="icon-btn" type="button" :disabled="state.busy" @click="toggleLike">
                <span :class="{ liked: !!state.isLiked }">♡</span>
                <b>{{ state.video.likes_count }}</b>
              </button>
              <button class="icon-btn" type="button">
                <span>◎</span>
                <b>{{ comments.list.length }}</b>
              </button>
              <button class="icon-btn" type="button" @click="share">
                <span>↗</span>
                <b>分享</b>
              </button>
            </div>
          </footer>
        </aside>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.page {
  height: 100%;
  min-height: 0;
  background: #0b0d0d;
  color: rgba(255, 255, 255, 0.9);
}

.center-hint {
  height: 100%;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.72);
}

.center-hint.bad {
  color: rgba(255, 120, 90, 0.92);
}

.note-reader {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(380px, 0.95fr);
  background: #090b0b;
}

.media-panel {
  min-width: 0;
  min-height: 0;
  position: relative;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background:
    radial-gradient(circle at 30% 12%, rgba(255, 255, 255, 0.08), transparent 34%),
    #050606;
}

.back-link {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  height: 38px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.38);
  color: rgba(255, 255, 255, 0.86);
  text-decoration: none;
  backdrop-filter: blur(14px);
}

.note-cover {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.detail-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: #0c0e0e;
}

.note-info {
  padding: 20px 24px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.author-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 18px;
}

.author-link {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  color: inherit;
  text-decoration: none;
}

.author-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  color: rgba(255, 255, 255, 0.78);
}

.follow-btn {
  min-width: 108px;
  height: 48px;
  border-radius: 999px;
  border: 0;
  background: #d7072a;
  color: #fff;
  font-size: 18px;
  font-weight: 800;
}

.note-copy {
  margin-top: 30px;
}

.title {
  margin: 0;
  color: rgba(255, 255, 255, 0.96);
  font-size: clamp(24px, 2.3vw, 34px);
  line-height: 1.22;
  font-weight: 850;
}

.desc {
  margin: 16px 0 0;
  color: rgba(255, 255, 255, 0.82);
  font-size: 18px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.meta-line {
  margin-top: 26px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
}

.meta-line a {
  color: rgba(190, 220, 255, 0.86);
  text-decoration: none;
}

.comment-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.comment-title {
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  color: rgba(255, 255, 255, 0.56);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.text-btn,
.more-btn {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.56);
  padding: 6px 0;
}

.more-btn.danger {
  color: rgba(255, 110, 130, 0.9);
}

.comment-list {
  min-height: 0;
  overflow: auto;
  padding: 8px 24px 18px;
}

.drawer-hint {
  padding: 22px 0;
  color: rgba(255, 255, 255, 0.62);
}

.drawer-hint.bad {
  color: rgba(255, 120, 90, 0.96);
}

.comment {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  padding: 18px 0;
}

.comment + .comment {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.comment-top {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.comment-user {
  color: rgba(255, 255, 255, 0.56);
  font-size: 16px;
}

.comment-content {
  margin-top: 6px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 17px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.comment-meta {
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.42);
  font-size: 13px;
}

.action-bar {
  min-height: 82px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(12, 14, 14, 0.96);
}

.comment-input {
  min-width: 0;
  height: 52px;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 14px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
}

.spark {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  color: #6d5b19;
}

.comment-input input {
  min-width: 0;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  padding: 0;
  box-shadow: none;
}

.comment-input input:focus {
  box-shadow: none;
}

.send-btn {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.84);
  font-weight: 800;
  padding: 8px 10px;
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.82);
  padding: 6px;
  font-size: 18px;
}

.icon-btn span {
  font-size: 32px;
  line-height: 1;
}

.icon-btn span.liked {
  color: #ff315c;
}

.icon-btn b {
  font-size: 18px;
  font-weight: 700;
}

@media (max-width: 980px) {
  .page {
    height: auto;
    min-height: 100%;
  }

  .note-reader {
    height: auto;
    min-height: 100%;
    grid-template-columns: 1fr;
  }

  .media-panel {
    min-height: 52vh;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .detail-panel {
    min-height: 72vh;
  }

  .note-info {
    padding: 18px 16px;
  }

  .comment-title,
  .comment-list {
    padding-left: 16px;
    padding-right: 16px;
  }

  .action-bar {
    position: sticky;
    bottom: 0;
    grid-template-columns: 1fr;
    padding: 12px 14px;
  }

  .quick-actions {
    justify-content: space-around;
  }
}
</style>
