<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import RelationGraph, { type ArchData, type GraphNode } from '@/components/charts/RelationGraph.vue'
import type { ArchEdge, ArchLayer, ArchSpine } from '@/composables/neural'
import EmptyState from '@/components/ui/EmptyState.vue'
import StatusTag from '@/components/ui/StatusTag.vue'
import PermissionButton from './PermissionButton.vue'
import { systemApi, type UserRow } from '@/api'
import { pathOf } from '@/composables/auth'
import { toastError } from '@/composables/toast'
import { hasPermission } from '@/directives/permission'

/* ============================================================
   岗位网络（架构图）：岗位按 sort 排成一条横向的层序列，读作大模型的
   网络架构——第一级是输入层，末级是输出层，中间是隐层。
   每层的神经元数量固定，人数不生成节点、只决定「点亮到第几颗」，
   因此渲染图元数只随岗位数变化，与在岗人数多少无关。
   选中某层时，该层高亮、在岗人员排在该层上方视觉上喂进这一层。
   ============================================================ */
export interface LadderPost { id: number; postName: string; postCode: string; sort: number; status: number; userCount: number }

const props = withDefaults(defineProps<{
  posts: LadderPost[]
  loading?: boolean
}>(), {
  loading: false,
})
const emit = defineEmits<{ (e: 'edit', post: LadderPost): void }>()

const router = useRouter()
const size = ref({ w: 0, h: 0 })
const steps = computed(() => [...props.posts].sort((a, b) => a.sort - b.sort || a.id - b.id))

const activeId = ref<number | null>(null)
const members = ref<UserRow[]>([])
const membersLoading = ref(false)
const canListUsers = hasPermission('system:user:list')
const usersPath = computed(() => pathOf('system/user/index'))

watch(steps, (list) => {
  if (activeId.value !== null && !list.some(p => p.id === activeId.value)) activeId.value = null
  if (activeId.value === null && list.length) activeId.value = list[list.length - 1].id
}, { immediate: true })
const active = computed(() => steps.value.find(p => p.id === activeId.value) ?? null)

async function loadMembers(id: number) {
  if (!canListUsers) { members.value = []; return }
  membersLoading.value = true
  try {
    const page = await systemApi.users.list({ postId: id, pageNum: 1, pageSize: 50 })
    members.value = page.rows as UserRow[]
  } catch (error) {
    members.value = []
    toastError(error, '在岗人员加载失败')
  } finally {
    membersLoading.value = false
  }
}
watch(activeId, (id) => { if (id !== null) loadMembers(id) }, { immediate: true })

const catOf = (i: number) => (i % 5) + 1

/** 布局常量：层柱宽度与每层神经元数都是固定的，不随数据变化 */
const PLATE = 52
const NEURONS = 5
const MEMBER_CAP = 6

interface Geom {
  w: number
  h: number
  padX: number
  half: number
  layers: Array<ArchLayer & { id: string }>
  activeIdx: number
}

const geom = computed<Geom | null>(() => {
  const { w, h } = size.value
  const list = steps.value
  const n = list.length
  if (!w || !h || !n) return null
  // 两侧留出层标签的宽度，否则最外两层的标签会被画布裁掉
const LABEL_HALF = 62
const padX = Math.max(LABEL_HALF, w * 0.04)
  const padTop = 108    // 上方让给在岗人员行
  const padBottom = 104 // 下方留给层标签
  const usable = Math.max(140, h - padTop - padBottom)
  const cy = padTop + usable / 2
  const half = Math.max(66, Math.min(148, usable / 2 - 8))
  const step = n > 1 ? (w - padX * 2) / (n - 1) : 0
  const maxCount = Math.max(1, ...list.map(p => p.userCount))
  const activeIdx = active.value ? list.findIndex(p => p.id === active.value!.id) : -1
  const layers = list.map<ArchLayer & { id: string }>((p, i) => ({
    id: `post:${p.id}`,
    x: n > 1 ? padX + step * i : w / 2,
    y: cy,
    h: half,
    // 人数只归一化成点亮强度，不产生任何新图元
    intensity: p.userCount / maxCount,
    cat: catOf(i),
    active: i === activeIdx,
    n: NEURONS,
    dim: activeIdx < 0 ? 1 : i === activeIdx ? 1 : Math.abs(i - activeIdx) === 1 ? 0.72 : 0.4,
  }))
  return { w, h, padX, half, layers, activeIdx }
})

/** 神经元的 y 坐标：与 paintArchNeurons 的排布一致 */
function neuronY(layer: ArchLayer, index: number) {
  return layer.y - layer.h + ((layer.h * 2) / (layer.n + 1)) * (index + 1)
}

const arch = computed<ArchData | null>(() => {
  const g = geom.value
  if (!g) return null
  const { layers } = g
  const edges: ArchEdge[] = []
  // 相邻层全连接，作为极淡的肌理；选中层附近才提亮
  for (let i = 0; i < layers.length - 1; i += 1) {
    const a = layers[i]
    const b = layers[i + 1]
    const near = a.active || b.active ? 0.11 : 0.055
    const dim = Math.min(a.dim, b.dim)
    for (let u = 0; u < a.n; u += 1) {
      for (let v = 0; v < b.n; v += 1) {
        edges.push({ x1: a.x, y1: neuronY(a, u), x2: b.x, y2: neuronY(b, v), cat: b.cat, w: near * dim })
      }
    }
  }
  // 主干：逐层穿过「最后一颗被点亮的神经元」，网络越满信号爬得越高
  const spine: ArchSpine = layers.map((l) => {
    const idx = Math.max(0, Math.min(l.n - 1, Math.round(l.intensity * l.n - 0.5)))
    return { x: l.x, y: neuronY(l, idx) }
  })
  const toneIdx = g.activeIdx >= 0 ? layers[g.activeIdx].cat : layers[0].cat
  return { layers, edges, spine, plate: PLATE, cat: toneIdx }
})

const rankOf = (i: number, n: number) => (n === 1 ? '单层' : i === 0 ? '输入层' : i === n - 1 ? '输出层' : `隐层 ${i}`)

const scene = computed<{ nodes: GraphNode[] }>(() => {
  const g = geom.value
  const list = steps.value
  if (!g) return { nodes: [] }
  const nodes: GraphNode[] = []
  const n = g.layers.length
  // 每层的标签块：等级、岗位名、编码、人数
  g.layers.forEach((l, i) => {
    const p = list[i]
    nodes.push({
      id: l.id,
      kind: 'arch',
      x: l.x,
      y: l.y + l.h + 44,
      label: p.postName,
      sub: p.postCode,
      count: p.userCount,
      rank: rankOf(i, n),
      cat: l.cat,
      tone: p.status !== 1 ? 'off' : undefined,
    })
  })
  // 选中层的在岗人员：横排在该层上方，读作喂进这一层的信号
  const post = active.value
  if (post && g.activeIdx >= 0) {
    const layer = g.layers[g.activeIdx]
    const shown = members.value.slice(0, MEMBER_CAP)
    const more = members.value.length - shown.length
    const items = shown.map(u => ({
      id: `u:${u.id}`,
      label: u.nickname,
      sub: [u.deptName, u.username].filter(Boolean).join(' · '),
      interactive: Boolean(usersPath.value),
    }))
    if (more > 0) items.push({ id: 'more', label: `还有 ${more} 人`, sub: '在用户页查看全部', interactive: false })
    if (!items.length && !membersLoading.value) {
      items.push({
        id: 'empty',
        label: canListUsers ? '暂无在岗人员' : `共 ${post.userCount} 人在岗`,
        sub: canListUsers ? '可在用户管理中为用户指定岗位' : '无用户查询权限，仅显示人数',
        interactive: false,
      })
    }
    const room = g.w - g.padX * 2
    const spacing = Math.min(126, Math.max(96, room / Math.max(items.length, 1)))
    const rowY = layer.y - layer.h - 42
    // 胶囊比层标签宽，整行平移进画布而不是逐个夹取，否则间距会被压塌
    const MEMBER_EDGE = 100
    const rowW = spacing * (items.length - 1)
    const origin = Math.max(MEMBER_EDGE, Math.min(g.w - MEMBER_EDGE - rowW, layer.x - rowW / 2))
    items.forEach((it, i) => {
      nodes.push({
        id: it.id,
        kind: 'item',
        align: 'center',
        x: origin + i * spacing,
        y: rowY,
        label: it.label,
        sub: it.sub,
        interactive: it.interactive,
        icon: it.id.startsWith('u:') ? 'user' : undefined,
        cat: it.id.startsWith('u:') ? layer.cat : undefined,
        tone: it.id.startsWith('u:') ? undefined : 'off',
      })
    })
  }
  return { nodes }
})

function onSelect(node: GraphNode) {
  if (node.id.startsWith('post:')) { activeId.value = Number(node.id.slice(5)); return }
  const user = members.value.find(u => `u:${u.id}` === node.id)
  if (user && usersPath.value) router.push({ path: usersPath.value, query: { keyword: user.username } })
}

const stageWidth = computed(() => Math.max(720, steps.value.length * 124 + 88))
</script>

<template>
  <div class="ladder">
    <RelationGraph
      v-model:size="size"
      class="ladder-stage"
      :style="{ minWidth: `${stageWidth}px` }"
      :arch="arch"
      variant="stage"
      label="岗位网络架构"
      :nodes="scene.nodes"
      :active-id="active ? `post:${active.id}` : null"
      @select="onSelect"
      @back="activeId = null"
    >
      <template v-if="active" #tl>
        <section class="ladder-card m-float" :class="`cat-${(steps.indexOf(active) % 5) + 1}`" aria-live="polite">
          <span class="ladder-card-rank">{{ rankOf(steps.indexOf(active), steps.length) }} · 第 {{ steps.indexOf(active) + 1 }} 级 / 共 {{ steps.length }} 级</span>
          <h3>{{ active.postName }}</h3>
          <span class="code-chip">{{ active.postCode }}</span>
          <dl>
            <div><dt>在岗</dt><dd class="tnum">{{ active.userCount }}<small>人</small></dd></div>
            <div><dt>排序</dt><dd class="tnum">{{ active.sort }}</dd></div>
          </dl>
          <StatusTag :status="active.status" />
          <div class="ladder-card-actions">
            <PermissionButton perm="system:post:edit" variant="secondary" size="sm" icon="edit" @click="emit('edit', active)">编辑岗位</PermissionButton>
          </div>
        </section>
      </template>
      <p v-if="steps.length" class="trace-hint">点击层查看在岗人员 · 方向键切换</p>
    </RelationGraph>
    <EmptyState v-if="!loading && !steps.length" class="ladder-empty" title="还没有岗位" icon="post" />
  </div>
</template>