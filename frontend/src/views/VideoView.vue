<script setup lang="ts">
import { onUnmounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'

import AppShell from '../components/AppShell.vue'
import { ApiError } from '../api/client'
import * as videoApi from '../api/video'
import type { Video } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { useToastStore } from '../stores/toast'

const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const busy = ref(false)
const stage = ref('')
const published = ref<Video | null>(null)
const coverInput = ref<HTMLInputElement | null>(null)

const publishForm = reactive({
  title: '',
  description: '',
  cover: null as File | null,
})

const preview = reactive({
  coverUrl: '',
})

function setPreviewCover(file: File | null) {
  if (preview.coverUrl) URL.revokeObjectURL(preview.coverUrl)
  preview.coverUrl = file ? URL.createObjectURL(file) : ''
}

watch(
  () => publishForm.cover,
  (f) => setPreviewCover(f),
)

onUnmounted(() => {
  setPreviewCover(null)
})

function pickCover(e: Event) {
  const input = e.target as HTMLInputElement
  publishForm.cover = input.files?.[0] ?? null
}

function openCoverPicker() {
  coverInput.value?.click()
}

function clearCover() {
  publishForm.cover = null
  if (coverInput.value) coverInput.value.value = ''
}

async function onPublish() {
  if (busy.value) return
  if (!auth.isLoggedIn) {
    toast.error('请先登录')
    await router.push('/account')
    return
  }

  const title = publishForm.title.trim()
  const description = publishForm.description.trim()
  if (!title) {
    toast.error('请输入标题')
    return
  }
  if (!publishForm.cover) {
    toast.error('请选择笔记主图（jpg/png/webp）')
    return
  }

  busy.value = true
  stage.value = ''
  published.value = null
  try {
    stage.value = '上传图片'
    const coverRes = await videoApi.uploadCover(publishForm.cover)
    const coverUrl = coverRes.url || coverRes.cover_url || ''
    if (!coverUrl) {
      toast.error('上传成功但缺少图片 URL')
      return
    }

    // 仍复用原有视频发布接口，快速切成图文模式。
    stage.value = '发布笔记'
    const res = await videoApi.publishVideo({
      title,
      description,
      play_url: coverUrl,
      cover_url: coverUrl,
    })

    published.value = res
    toast.success('笔记已发布')

    publishForm.title = ''
    publishForm.description = ''
    clearCover()
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : String(e)
    toast.error(msg)
  } finally {
    busy.value = false
    stage.value = ''
  }
}
</script>

<template>
  <AppShell>
    <div class="publish-wrap">
      <div class="card publish-card">
        <div class="row" style="justify-content: space-between; align-items: baseline">
          <p class="title" style="margin: 0">发布图文笔记</p>
          <div v-if="busy" class="pill">进行中：{{ stage || '…' }}</div>
        </div>
        <p class="subtle" style="margin-top: 10px">
          这里已经切成“小红书式图文发布”。为了快速演示，前端只上传一张主图，然后继续复用原来的 `/video/publish` 接口入库。
        </p>

        <div class="grid form-grid" style="margin-top: 16px">
          <div>
            <label>标题</label>
            <input v-model.trim="publishForm.title" class="big-input" :disabled="busy" placeholder="例如：周末在安福路拍到的秋天光影" />
          </div>
          <div>
            <label>正文</label>
            <textarea
              v-model.trim="publishForm.description"
              class="big-input"
              :disabled="busy"
              placeholder="写下这条图文笔记的内容、心得、穿搭、探店、旅行记录……"
            />
          </div>
          <div>
            <label>主图 (jpg/png/webp)</label>
            <input
              ref="coverInput"
              class="file-native"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              :disabled="busy"
              @change="pickCover"
            />
            <div class="file-box">
              <button type="button" :disabled="busy" @click="openCoverPicker">选择主图</button>
              <div class="file-name" :class="publishForm.cover ? '' : 'muted'">
                {{ publishForm.cover ? publishForm.cover.name : '未选择图片' }}
              </div>
              <button v-if="publishForm.cover" type="button" :disabled="busy" @click="clearCover">清除</button>
            </div>
            <div v-if="publishForm.cover" class="subtle" style="margin-top: 6px">已选择：{{ publishForm.cover.name }}</div>
          </div>

          <div v-if="preview.coverUrl" class="preview-card">
            <div class="subtle">笔记主图预览</div>
            <img class="cover" :src="preview.coverUrl" alt="cover preview" />
          </div>

          <div class="row" style="justify-content: flex-end; margin-top: 8px">
            <button class="primary big-btn" type="button" :disabled="busy" @click="onPublish">发布笔记</button>
          </div>
        </div>

        <div v-if="published" class="card" style="margin-top: 14px">
          <p class="title">已发布的笔记</p>
          <div class="row" style="justify-content: space-between">
            <div>
              <div class="title" style="margin: 0">{{ published.title }}</div>
              <div class="subtle mono">#{{ published.id }}</div>
            </div>
            <div class="row">
              <RouterLink class="pill" :to="`/video/${published.id}`">查看笔记</RouterLink>
              <a class="pill mono" :href="published.cover_url" target="_blank" rel="noreferrer">image_url</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.publish-wrap {
  display: grid;
  justify-items: center;
}

.publish-card {
  width: min(980px, 100%);
  padding: 22px;
}

.form-grid {
  gap: 16px;
}

.preview-card {
  display: grid;
  gap: 8px;
  padding: 14px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.cover {
  width: min(360px, 100%);
  display: block;
  border-radius: 18px;
  aspect-ratio: 4 / 5;
  object-fit: cover;
}

label {
  display: inline-block;
  margin-bottom: 8px;
  color: rgba(255, 255, 255, 0.82);
}

.big-input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  padding: 14px 16px;
}

textarea.big-input {
  min-height: 160px;
  resize: vertical;
}

.file-native {
  display: none;
}

.file-box {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-name.muted {
  color: rgba(255, 255, 255, 0.45);
}

.big-btn {
  min-width: 140px;
}
</style>
