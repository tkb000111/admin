<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from '@/components/ui/Avatar.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import HoverCard from '@/components/ui/HoverCard.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PermissionButton from './PermissionButton.vue'
import { systemApi, type UserRow } from '@/api'
import { pathOf } from '@/composables/auth'
import { toastError } from '@/composables/toast'
import { hasPermission } from '@/directives/permission'

/* ============================================================
   岗位矩阵。岗位本身是扁平的——sort 只是列表顺序，不代表层级或汇报关系，
   所以这里不画任何层级结构，只回答两件事：
     有哪些岗位、每个岗位多少人（顶部横排，一眼可见）
     某个岗位上是谁（下面的网格，点哪个岗位就查哪个岗位）
   人员按需取数并缓存：点开才查，来回切换不重复请求。
   ============================================================ */
export interface MatrixPost { id: number; postName: string; postCode: string; sort: number; status: number; userCount: number }

const props = withDefaults(defineProps<{
  posts: MatrixPost[]
  loading?: boolean
}>(), {
  loading: false,
})
const emit = defineEmits<{ (e: 'edit', post: MatrixPost): void }>()

const router = useRouter()
const steps = computed(() => [...props.posts].sort((a, b) => a.sort - b.sort || a.id - b.id))
const totalOn = computed(() => steps.value.reduce((n, p) => n + (p.userCount || 0), 0))
const canListUsers = hasPermission('system:user:list')
const usersPath = computed(() => pathOf('system/user/index'))

/* 默认落在人最多的岗位上：进页面就有内容，且直接回答「哪个岗位人最多」 */
const activeId = ref<number | null>(null)
watch(steps, (list) => {
  if (activeId.value !== null && list.some(p => p.id === activeId.value)) return
  const best = [...list].sort((a, b) => (b.userCount || 0) - (a.userCount || 0) || a.sort - b.sort)[0]
  activeId.value = best?.id ?? null
}, { immediate: true })
const active = computed(() => steps.value.find(p => p.id === activeId.value) ?? null)

/* 按需取数：点哪个岗位才查哪个；查过就缓存 */
const cache = new Map<number, UserRow[]>()
const members = ref<UserRow[]>([])
const membersLoading = ref(false)
let seq = 0

async function loadMembers(id: number) {
  if (!canListUsers) { members.value = []; return }
  const hit = cache.get(id)
  if (hit) { members.value = hit; return }
  const mine = ++seq
  membersLoading.value = true
  members.value = []
  try {
    const page = await systemApi.users.list({ postId: id, pageNum: 1, pageSize: 200 })
    const rows = page.rows as UserRow[]
    cache.set(id, rows)
    // 快速来回切换时丢弃过期响应，避免后到的把先到的盖掉
    if (mine === seq) members.value = rows
  } catch (error) {
    if (mine === seq) { members.value = []; toastError(error, '在岗人员加载失败') }
  } finally {
    if (mine === seq) membersLoading.value = false
  }
}
watch(activeId, id => { if (id !== null) loadMembers(id) }, { immediate: true })

/* 岗位在岗数变了（新增 / 编辑 / 调岗）就作废缓存并重查当前岗位 */
watch(() => props.posts.map(p => `${p.id}:${p.userCount}`).join(','), () => {
  cache.clear()
  if (activeId.value !== null) loadMembers(activeId.value)
})

function openUser(u: UserRow) {
  if (usersPath.value) router.push({ path: usersPath.value, query: { keyword: u.username } })
}
</script>

<template>
  <div class="pmat">
    <div v-if="steps.length" class="pmat-bar">
      <div class="pmat-bar-head">
        <span class="eyebrow">岗位</span>
        <span class="pmat-sum">
          <b class="tnum">{{ steps.length }}</b> 个岗位 · 在岗 <b class="tnum">{{ totalOn }}</b> 人
        </span>
      </div>
      <div class="pmat-chips" role="group" aria-label="按岗位查看在岗人员">
        <button
          v-for="p in steps"
          :key="p.id"
          type="button"
          :class="['pmat-chip', { 'is-on': p.id === activeId, 'is-off': p.status !== 1 }]"
          :aria-pressed="p.id === activeId"
          @click="activeId = p.id"
        >
          <span class="pmat-chip-name">{{ p.postName }}</span>
          <span class="pmat-chip-count tnum">{{ p.userCount || 0 }}<small>人</small></span>
        </button>
      </div>
    </div>

    <section v-if="active" class="pmat-panel" aria-live="polite">
      <header class="pmat-panel-head">
        <div class="pmat-panel-id">
          <h3>{{ active.postName }}</h3>
          <span class="code-chip">{{ active.postCode }}</span>
          <StatusTag :status="active.status" />
        </div>
        <div class="pmat-panel-meta">
          <span class="faint">在岗 <b class="tnum">{{ members.length }}</b> 人</span>
          <PermissionButton perm="system:post:edit" variant="secondary" size="sm" icon="edit" @click="emit('edit', active)">编辑岗位</PermissionButton>
        </div>
      </header>

      <p v-if="membersLoading" class="pmat-hint">正在加载在岗人员…</p>
      <ul v-else-if="members.length" class="pmat-grid">
        <li v-for="u in members" :key="u.id">
          <HoverCard :delay="260" :width="288">
            <button type="button" class="pmat-cell" :class="{ 'is-off': u.status !== 1 }" @click="openUser(u)">
              <Avatar :name="u.nickname" :size="34" />
              <span class="pmat-cell-text">
                <span class="pmat-cell-name">{{ u.nickname }}</span>
                <span class="pmat-cell-sub">{{ u.deptName || '未分配部门' }}</span>
              </span>
            </button>
            <template #card>
              <div class="hc-head">
                <Avatar :name="u.nickname" :size="40" />
                <div>
                  <div class="hc-name">{{ u.nickname }}</div>
                  <div class="hc-sub">@{{ u.username }}</div>
                </div>
              </div>
              <dl class="hc-rows">
                <dt>部门</dt><dd>{{ u.deptName || '—' }}</dd>
                <dt>岗位</dt><dd>{{ active.postName }}</dd>
                <dt>角色</dt><dd>{{ u.roleName || '—' }}</dd>
                <dt>邮箱</dt><dd>{{ u.email || '—' }}</dd>
                <dt>最近登录</dt><dd class="tnum">{{ u.lastLogin || '从未登录' }}</dd>
              </dl>
            </template>
          </HoverCard>
        </li>
      </ul>
      <EmptyState
        v-else
        class="pmat-empty"
        :title="canListUsers ? '该岗位暂无在岗人员' : `共 ${active.userCount} 人在岗`"
        :desc="canListUsers ? '可在用户管理中为用户指定岗位' : '你没有用户查询权限，只能看到人数'"
      />
    </section>

    <EmptyState v-else-if="!loading && !steps.length" class="pmat-empty" title="还没有岗位" icon="post" />
  </div>
</template>