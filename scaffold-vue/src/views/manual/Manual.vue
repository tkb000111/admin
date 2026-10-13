<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { loadPermissionGraph, permissionIndex } from '@/composables/permissionGraph'
import { systemApi } from '@/api'
import { toastError } from '@/composables/toast'
import { isSuperRole, roleActive } from '@/utils/permissionGraph'

/* ============================================================
   使用手册 · 权限鱼骨（静态神经网络，固定画布坐标系 960 宽）：
   - 主骨：菜单管理 →(授予) 角色管理 →(分配) 用户管理 → 能登录干活；
     部门 / 岗位两支路从用户管理向后斜伸。节点为小圆点 + 前置小信息胶囊，
     数字全部来自真实数据；无动画、无表盘，布局永不随屏幕挤压。
   - 点开哪个板块就展开哪个（可多个同时展开，各自保持）：
     主线板块以节点为分界上下排，支路板块从自己顶点向下排。
   - 同展开的板块之间画真实关系线：角色 ↔ 页面（授权）、角色 / 部门 / 岗位 → 用户；
     点某个具体条目只看它的关系网络，再点一次或 Esc 取消。
   ============================================================ */
const CAT = { dept: 1, user: 2, role: 3, post: 4, menu: 5 } as const
type Panel = 'menu' | 'role' | 'dept' | 'post'

const loading = ref(true)
const opened = ref<Panel[]>([])
const selected = ref<string | null>(null)
const deptTree = ref<Record<string, unknown>[]>([])
const postRows = ref<Array<Record<string, unknown>>>([])
const deptCount = ref<number | string>('—')
const postCount = ref<number | string>('—')

const index = computed(() => permissionIndex.value)

function countTree(nodes: Record<string, unknown>[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countTree((node.children ?? []) as Record<string, unknown>[]), 0)
}
function flattenTree(nodes: Record<string, unknown>[], depth = 0): Array<{ node: Record<string, unknown>; depth: number }> {
  return nodes.flatMap(node => [{ node, depth }, ...flattenTree((node.children ?? []) as Record<string, unknown>[], depth + 1)])
}

onMounted(async () => {
  try {
    await Promise.all([
      loadPermissionGraph(true),
      systemApi.depts.tree().then((tree) => { deptTree.value = tree; deptCount.value = countTree(tree) }, () => {}),
      systemApi.posts.list({ pageNum: 1, pageSize: 100 }).then((result) => { postRows.value = (result.rows ?? []) as Array<Record<string, unknown>>; postCount.value = result.total }, () => {}),
    ])
  } catch (error) {
    toastError(error, '使用手册数据加载失败')
  } finally {
    loading.value = false
  }
})

const counts = computed(() => {
  const idx = index.value
  return {
    menu: idx ? idx.graph.menus.filter(m => m.type === 'menu').length : '—',
    role: idx ? idx.graph.roles.length : '—',
    user: idx && idx.graph.usersVisible ? idx.graph.users.length : '—',
  }
})

/* ── 固定坐标系（宽 960，主线 y=380），任何屏幕同一张图：不缩放，超出容器内部滚动 ── */
const W = 960
const BONE_Y = 380
const CARD_W = 104
const CARD_H = 26
const DOT_R = 13
const ITEM_W = 118
const ITEM_H = 22
const ITEM_GAP = 26
const P = {
  menu: { x: 148, y: BONE_Y },
  role: { x: 352, y: BONE_Y },
  user: { x: 628, y: BONE_Y },
  head: { x: 852, y: BONE_Y },
  dept: { x: 488, y: 130 },
  post: { x: 488, y: 630 },
} as const

/* 主线节点：小圆点骑线 + 右侧垂直居中的单行信息卡（地铁图式）；鱼头为绿色胶囊 */
interface BoneNode { id: Panel | 'user' | 'head'; dot: { x: number; y: number }; cat: number; title: string; count: number | string; clickable: boolean; head?: boolean }
const boneNodes = computed((): BoneNode[] => [
  { id: 'menu', dot: P.menu, cat: CAT.menu, title: '菜单管理', count: counts.value.menu, clickable: true },
  { id: 'role', dot: P.role, cat: CAT.role, title: '角色管理', count: counts.value.role, clickable: true },
  { id: 'user', dot: P.user, cat: CAT.user, title: '用户管理', count: counts.value.user, clickable: false },
  { id: 'dept', dot: P.dept, cat: CAT.dept, title: '部门管理', count: deptCount.value, clickable: true },
  { id: 'post', dot: P.post, cat: CAT.post, title: '岗位管理', count: postCount.value, clickable: true },
  { id: 'head', dot: P.head, cat: CAT.menu, title: '能登录干活', count: '', clickable: false, head: true },
])

const arrows = [
  { x1: 278, x2: 328, label: '授予' },
  { x1: 482, x2: 604, label: '分配' },
  { x1: 758, x2: 787, label: '' },
]
const fins = [
  { d: 'M 619 371 L 497 139', cat: CAT.dept },
  { d: 'M 619 389 L 497 621', cat: CAT.post },
]

/* ── 各板块真实条目 ── */
interface Entry { key: string; name: string; note: string; off?: boolean }
const entries = computed<Record<Panel, Entry[]> | null>(() => {
  const idx = index.value
  if (!idx) return null
  const pageMenus = idx.graph.menus.filter(m => m.type === 'menu')
  const menus: Entry[] = pageMenus.map((m) => {
    const grants = (idx.rolesOfMenu.get(m.id) ?? []).filter(id => roleActive(idx.role.get(id)) && !isSuperRole(idx.role.get(id))).length
    return { key: `menu:${m.id}`, name: m.name, note: String(grants), off: m.status !== 1 }
  })
  const roles: Entry[] = idx.graph.roles.map((r) => {
    const users = idx.usersOfRole.get(r.id)?.length ?? r.userCount ?? 0
    return { key: `role:${r.id}`, name: r.name, note: String(users), off: r.status !== 1 }
  })
  const depts: Entry[] = flattenTree(deptTree.value).map(({ node }) => {
    const name = String(node.name ?? '未命名部门')
    return { key: `dept:${String(node.id)}`, name, note: String(Number(node.memberCount ?? 0)), off: false }
  })
  const posts: Entry[] = postRows.value.map(row => ({ key: `post:${String(row.id)}`, name: String(row.postName ?? '未命名岗位'), note: String(Number(row.userCount ?? 0)) }))
  return { menu: menus, role: roles, dept: depts, post: posts }
})

/* ── 展开排布：主线板块以节点为分界上下排；支路板块从顶点向下排 ── */
function spotsOf(panel: Panel): number[] {
  const list = entries.value?.[panel] ?? []
  const n = list.length
  const spots: number[] = []
  // 列表起点一律以信息胶囊的上下边框为准，避免与胶囊、相邻板块重叠
  if (panel === 'menu' || panel === 'role') {
    // 主线板块：以胶囊边框为界，一半往上一半往下；上方空间有限，其余向下
    const firstUp = BONE_Y - CARD_H / 2 - ITEM_H / 2 - 8
    const firstDown = BONE_Y + CARD_H / 2 + ITEM_H / 2 + 8
    const upCap = Math.floor((firstUp - 40) / ITEM_GAP) + 1
    const up = Math.min(upCap, Math.ceil(n / 2))
    for (let i = 0; i < up; i += 1) spots.push(firstUp - i * ITEM_GAP)
    for (let i = 0; i < n - up; i += 1) spots.push(firstDown + i * ITEM_GAP)
  } else if (panel === 'dept') {
    // 部门（主线上方）：先从胶囊下边框往主线方向排、绝不越过主线带；排不下的往外侧（上）排
    const toward = P.dept.y + CARD_H / 2 + ITEM_H / 2 + 8
    const limit = BONE_Y - 30
    const downCap = Math.max(1, Math.floor((limit - toward) / ITEM_GAP) + 1)
    const away = P.dept.y - CARD_H / 2 - ITEM_H / 2 - 8
    const upCap = Math.max(0, Math.floor((away - 26) / ITEM_GAP) + 1)
    const down = Math.min(n, downCap)
    for (let i = 0; i < down; i += 1) spots.push(toward + i * ITEM_GAP)
    for (let i = 0; i < Math.min(n - down, upCap); i += 1) spots.push(away - i * ITEM_GAP)
  } else {
    // 岗位（主线下方）：先从胶囊上边框往主线方向排、绝不越过主线带；排不下的往外侧（下）排
    const toward = P.post.y - CARD_H / 2 - ITEM_H / 2 - 8
    const limit = BONE_Y + 30
    const upCap = Math.max(1, Math.floor((toward - limit) / ITEM_GAP) + 1)
    const away = P.post.y + CARD_H / 2 + ITEM_H / 2 + 8
    const up = Math.min(n, upCap)
    for (let i = 0; i < up; i += 1) spots.push(toward - i * ITEM_GAP)
    for (let i = 0; i < n - up; i += 1) spots.push(away + i * ITEM_GAP)
  }
  return spots
}

/* 条目落位：超出容量的最后一格显示「还有 X 项」 */
interface PlacedItem { key: string; name: string; note: string; off?: boolean; x: number; y: number; cat: number }
interface PanelLayout { items: PlacedItem[]; more: number; moreY: number; bottom: number }
const layout = computed<Record<Panel, PanelLayout> | null>(() => {
  const all = entries.value
  if (!all) return null
  const out = {} as Record<Panel, PanelLayout>
  for (const panel of ['menu', 'role', 'dept', 'post'] as Panel[]) {
    const list = all[panel]
    const spots = spotsOf(panel)
    const cap = spots.length
    const full = list.length <= cap
    const shownCount = full ? list.length : cap - 1
    const more = full ? 0 : list.length - shownCount
    const x = P[panel].x
    const cat = panel === 'menu' ? CAT.menu : panel === 'role' ? CAT.role : panel === 'dept' ? CAT.dept : CAT.post
    const items: PlacedItem[] = list.slice(0, shownCount).map((entry, i) => ({ ...entry, x, y: spots[i], cat }))
    const lastSpot = spots[Math.max(0, shownCount - 1)] ?? P[panel].y
    const bottomSpot = more ? spots[cap - 1] : lastSpot
    out[panel] = { items, more, moreY: spots[cap - 1] ?? P[panel].y, bottom: bottomSpot + ITEM_H / 2 }
  }
  return out
})

/* ── 关系线：同展开板块之间的真实连线 ── */
interface LinkPos { key: string; d: string; cat: number; ends: string[] }
const links = computed<LinkPos[]>(() => {
  const idx = index.value
  const lay = layout.value
  if (!idx || !lay || !opened.value.length) return []
  const out: LinkPos[] = []
  const userKey = 'user'
  const roleOpen = opened.value.includes('role')
  const menuOpen = opened.value.includes('menu')
  const find = (panel: Panel, key: string) => lay[panel].items.find(item => item.key === key)
  if (roleOpen) {
    for (const item of lay.role.items) {
      // 持有线：角色 → 用户终端
      out.push({ key: `hold:${item.key}`, cat: CAT.user, ends: [item.key, userKey], d: `M ${item.x + ITEM_W / 2} ${item.y} C 520 ${item.y}, 560 ${BONE_Y}, ${P.user.x - DOT_R - 3} ${BONE_Y}` })
      // 授权线：角色 ↔ 页面（两端都展开才画）
      if (menuOpen) {
        const role = idx.role.get(Number(item.key.split(':')[1]))
        if (role) {
          const ids = isSuperRole(role) ? idx.graph.menus.map(m => m.id) : role.menuIds
          for (const id of ids) {
            const menu = find('menu', `menu:${id}`)
            if (menu) out.push({ key: `grant:${item.key}>${menu.key}`, cat: CAT.menu, ends: [item.key, menu.key], d: `M ${item.x - ITEM_W / 2} ${item.y} C 250 ${item.y}, 250 ${menu.y}, ${menu.x + ITEM_W / 2} ${menu.y}` })
          }
        }
      }
    }
  }
  for (const panel of ['dept', 'post'] as Panel[]) {
    if (!opened.value.includes(panel)) continue
    for (const item of lay[panel].items) {
      out.push({ key: `org:${item.key}`, cat: panel === 'dept' ? CAT.dept : CAT.post, ends: [item.key, userKey], d: `M ${item.x + ITEM_W / 2} ${item.y} C 592 ${item.y}, 592 ${BONE_Y}, ${P.user.x - DOT_R - 3} ${BONE_Y}` })
    }
  }
  return out
})

/* 聚焦：选中的条目 + 它的关系线保持，其余淡化 */
const litKeys = computed<Set<string> | null>(() => {
  const key = selected.value
  if (!key) return null
  const set = new Set<string>([key])
  for (const link of links.value) if (link.ends.includes(key)) link.ends.forEach(end => set.add(end))
  return set
})
const isLit = (key: string, isUser = false) => {
  if (!litKeys.value) return true
  return isUser ? true : litKeys.value.has(key)
}

const viewH = computed(() => {
  const base = P.post.y + CARD_H / 2 + 44
  const bottoms = opened.value.map(panel => layout.value?.[panel].bottom ?? 0)
  return Math.max(base, ...bottoms)
})

const legend = computed(() => [
  { label: '页面', value: counts.value.menu, cat: CAT.menu },
  { label: '角色', value: counts.value.role, cat: CAT.role },
  { label: '用户', value: counts.value.user, cat: CAT.user },
  { label: '部门', value: deptCount.value, cat: CAT.dept },
  { label: '岗位', value: postCount.value, cat: CAT.post },
])

function toggle(node: BoneNode) {
  if (!node.clickable) return
  const id = node.id as Panel
  const at = opened.value.indexOf(id)
  if (at >= 0) { opened.value.splice(at, 1); if (selected.value) selected.value = null }
  else opened.value.push(id)
}
/* 一键全部展开 / 收起 */
const allOpen = computed(() => opened.value.length === 4)
function toggleAll() {
  selected.value = null
  opened.value = allOpen.value ? [] : ['menu', 'role', 'dept', 'post']
}
function pick(item: PlacedItem) {
  selected.value = selected.value === item.key ? null : item.key
}
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (selected.value) selected.value = null
  else opened.value = []
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="manual">
    <header class="manual-bar">
      <div class="manual-legend" aria-label="真实数据读数">
        <span v-for="item in legend" :key="item.label" :class="`cat-${item.cat}`"><i />{{ item.label }}<b class="tnum">{{ item.value }}</b></span>
      </div>
    </header>
    <div class="manual-frame">
      <button type="button" class="manual-expand" @click="toggleAll">{{ allOpen ? '全部收起' : '全部展开' }}</button>
      <div class="manual-scroll">
        <svg class="manual-svg" :class="{ 'is-focusing': selected }" :viewBox="`0 0 ${W} ${viewH}`" role="img" aria-label="权限鱼骨图">
        <!-- 主骨、箭头与支路 -->
        <line class="mn-spine" :x1="40" :y1="BONE_Y" :x2="930" :y2="BONE_Y" />
        <path v-for="fin in fins" :key="fin.d" class="mn-fin" :class="`cat-${fin.cat}`" :d="fin.d" />
        <g v-for="arrow in arrows" :key="arrow.x1">
          <line class="mn-flow" :x1="arrow.x1" :y1="BONE_Y" :x2="arrow.x2" :y2="BONE_Y" />
          <path class="mn-arrowhead" :d="`M ${arrow.x2} ${BONE_Y - 4.5} L ${arrow.x2 + 8} ${BONE_Y} L ${arrow.x2} ${BONE_Y + 4.5} Z`" />
          <text v-if="arrow.label" class="mn-flow-label" :x="(arrow.x1 + arrow.x2) / 2" :y="BONE_Y - 12">{{ arrow.label }}</text>
        </g>

        <!-- 关系线（先画，条目与信息卡覆盖其上） -->
        <path v-for="link in links" :key="link.key" class="mn-link" :class="[`cat-${link.cat}`, { 'is-lit': selected && link.ends.includes(selected), 'is-dim': selected && !link.ends.includes(selected) }]" :d="link.d" />

        <!-- 展开条目：名称居中，数字固定在右缘，对齐一致 -->
        <template v-for="panel in opened" :key="panel">
          <template v-if="layout">
            <g v-for="item in layout[panel].items" :key="item.key" class="mn-item" :class="[`cat-${item.cat}`, { 'is-off': item.off, 'is-lit': isLit(item.key), 'is-dim': !isLit(item.key), 'is-selected': selected === item.key }]" @click="pick(item)">
              <rect :x="item.x - ITEM_W / 2" :y="item.y - ITEM_H / 2" :width="ITEM_W" :height="ITEM_H" rx="7" />
              <text class="mn-item-name" :x="item.x" :y="item.y">{{ item.name }}</text>
              <text class="mn-item-note tnum" :x="item.x + ITEM_W / 2 - 9" :y="item.y">{{ item.note }}</text>
            </g>
            <text v-if="layout[panel].more" class="mn-more" :x="P[panel].x" :y="layout[panel].moreY + 1">还有 {{ layout[panel].more }} 项</text>
          </template>
        </template>

        <!-- 节点：小圆点骑线 + 右侧垂直居中的单行信息卡；名称居中、数字固定右缘 -->
        <g
          v-for="node in boneNodes"
          :key="node.id"
          class="mn-node"
          :class="[`cat-${node.cat}`, { 'is-clickable': node.clickable, 'is-open': opened.includes(node.id as Panel), 'is-head': node.head }]"
          :tabindex="node.clickable ? 0 : -1"
          :role="node.clickable ? 'button' : undefined"
          @click="toggle(node)"
          @keydown.enter.prevent="toggle(node)"
        >
          <template v-if="node.head">
            <rect :x="node.dot.x - 44" :y="node.dot.y - 15" width="88" height="30" rx="15" />
            <text class="mn-title" :x="node.dot.x" :y="node.dot.y">{{ node.title }}</text>
          </template>
          <template v-else>
            <circle class="mn-dot" :cx="node.dot.x" :cy="node.dot.y" :r="DOT_R" />
            <rect class="mn-card" :x="node.dot.x + DOT_R + 6" :y="node.dot.y - CARD_H / 2" :width="CARD_W" :height="CARD_H" rx="8" />
            <text class="mn-title" :x="node.dot.x + DOT_R + 6 + CARD_W / 2" :y="node.dot.y">{{ node.title }}</text>
            <text v-if="node.count !== ''" class="mn-count tnum" :x="node.dot.x + DOT_R + 6 + CARD_W - 9" :y="node.dot.y">{{ node.count }}</text>
          </template>
        </g>
      </svg>
    </div>
    <p v-if="loading" class="manual-loading">正在汇总真实数据…</p>
  </div>
  </div>
</template>
