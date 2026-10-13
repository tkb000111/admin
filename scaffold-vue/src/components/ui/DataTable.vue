<script setup lang="ts" generic="Row extends Record<string, any>">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import Checkbox from './Checkbox.vue'
import EmptyState from './EmptyState.vue'
import { revealRows } from '@/composables/motion'

export interface Column {
  key: string
  title: string
  width?: number
  minWidth?: number
  align?: 'left' | 'center' | 'right'
  className?: string
}

const props = withDefaults(defineProps<{
  columns: Column[]
  data: Row[]
  rowKey?: string
  selectable?: boolean
  selected?: (string | number)[]
  loading?: boolean
  emptyText?: string
  /** 树形表格：按 children 展开，首列带缩进与展开按钮 */
  tree?: boolean
  /** 树形表格默认展开到第几层（0 = 全部收起） */
  expandDepth?: number
  minWidth?: number
  /** 虚拟滚动：'auto' 按行数自动启用（默认），'on' 强制，'off' 关闭 */
  virtual?: 'auto' | 'on' | 'off'
  /** 超过多少行才启用虚拟滚动 */
  virtualThreshold?: number
}>(), {
  rowKey: 'id',
  selected: () => [],
  emptyText: '暂无数据',
  expandDepth: 1,
  virtual: 'auto',
  virtualThreshold: 60,
})

const emit = defineEmits<{
  (e: 'update:selected', value: (string | number)[]): void
  (e: 'row-click', row: Row): void
}>()

const body = ref<HTMLElement | null>(null)
const wrap = ref<HTMLElement | null>(null)
const table = ref<HTMLElement | null>(null)
const expanded = ref(new Set<string | number>())

interface FlatRow { row: Row; depth: number; hasChildren: boolean }

const flatRows = computed<FlatRow[]>(() => {
  if (!props.tree) return props.data.map(row => ({ row, depth: 0, hasChildren: false }))
  const list: FlatRow[] = []
  const walk = (rows: Row[], depth: number) => rows.forEach(row => {
    const children = (row.children ?? []) as Row[]
    list.push({ row, depth, hasChildren: children.length > 0 })
    if (children.length && expanded.value.has(row[props.rowKey])) walk(children, depth + 1)
  })
  walk(props.data, 0)
  return list
})

const keys = computed(() => flatRows.value.map(item => item.row[props.rowKey]))
const allChecked = computed(() => keys.value.length > 0 && keys.value.every(k => props.selected.includes(k)))
const someChecked = computed(() => !allChecked.value && keys.value.some(k => props.selected.includes(k)))
const colspan = computed(() => props.columns.length + (props.selectable ? 1 : 0))

function toggleAll() {
  emit('update:selected', allChecked.value ? [] : [...keys.value])
}

function toggleRow(key: string | number) {
  emit('update:selected', props.selected.includes(key)
    ? props.selected.filter(k => k !== key)
    : [...props.selected, key])
}

function toggleExpand(key: string | number) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}

function collectKeys(rows: Row[], depthLimit: number, depth = 0, acc = new Set<string | number>()) {
  rows.forEach(row => {
    const children = (row.children ?? []) as Row[]
    if (children.length && depth < depthLimit) {
      acc.add(row[props.rowKey])
      collectKeys(children, depthLimit, depth + 1, acc)
    }
  })
  return acc
}

function expandAll() { expanded.value = collectKeys(props.data, Infinity) }
function collapseAll() { expanded.value = new Set() }

let initialized = false
let lastSignature = ''
watch(() => props.data, (rows) => {
  if (props.tree && !initialized && rows.length) {
    expanded.value = collectKeys(rows, props.expandDepth)
    initialized = true
  }
  // 换了一批数据才按阅读序显现；原地修改（如切换开关）不重播
  const signature = rows.map(row => row[props.rowKey]).join(',')
  if (signature === lastSignature) return
  lastSignature = signature
  nextTick(() => { if (body.value) revealRows(body.value.querySelectorAll('tr.data-row')) })
}, { immediate: true })

function cellStyle(col: Column) {
  return {
    width: col.width ? `${col.width}px` : undefined,
    minWidth: col.minWidth ? `${col.minWidth}px` : undefined,
    textAlign: col.align,
  }
}

/* ============================================================
   虚拟滚动

   与外壳共用同一个滚动容器（内容区），不额外套滚动层：
   按固定行高推算可视区间，只渲染可视行 + 少量缓冲，
   上下各用一条占位行撑出真实总高，滚动条长度与真实数据量一致。
   行数不多时不启用——小列表全量渲染，浏览器查找（Ctrl+F）也能命中。
   ============================================================ */

const OVERSCAN = 8
const virtualOn = computed(() =>
  props.virtual === 'on' || (props.virtual === 'auto' && flatRows.value.length > props.virtualThreshold))

const rowH = ref(48)
const viewportH = ref(0)
const tableTop = ref(0)
const scrollTop = ref(0)

/** 行高来自设计令牌（48 / 56 / 40 随密度切换），与 .table td 用同一个变量 */
function readRowHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--row-h')
  const parsed = Number.parseFloat(raw)
  if (Number.isFinite(parsed) && parsed > 0) rowH.value = parsed
}

/** 最近的纵向滚动容器；没有则退化为文档滚动容器 */
function findScroller(): HTMLElement | null {
  let el = table.value?.parentElement ?? null
  while (el) {
    const y = getComputedStyle(el).overflowY
    if (y === 'auto' || y === 'scroll') return el
    el = el.parentElement
  }
  return (document.scrollingElement as HTMLElement | null)
}

function measure() {
  const scroller = findScroller()
  if (!scroller || !table.value) return
  const scrollerRect = scroller.getBoundingClientRect()
  const tableRect = table.value.getBoundingClientRect()
  // 表格上沿相对滚动容器内容顶部的位置
  tableTop.value = tableRect.top - scrollerRect.top + scroller.scrollTop
  viewportH.value = scroller.clientHeight
  scrollTop.value = scroller.scrollTop
}

const visibleRange = computed(() => {
  const total = flatRows.value.length
  const first = Math.max(0, Math.floor((scrollTop.value - tableTop.value) / rowH.value) - OVERSCAN)
  const count = Math.ceil(viewportH.value / rowH.value) + OVERSCAN * 2
  const start = Math.min(first, Math.max(0, total - 1))
  const end = Math.min(total, start + Math.max(1, count))
  return { start, end }
})

const visibleRows = computed(() =>
  virtualOn.value ? flatRows.value.slice(visibleRange.value.start, visibleRange.value.end) : flatRows.value)
const padTop = computed(() => virtualOn.value ? visibleRange.value.start * rowH.value : 0)
const padBottom = computed(() =>
  virtualOn.value ? Math.max(0, (flatRows.value.length - visibleRange.value.end) * rowH.value) : 0)

let frame = 0
function schedule() {
  if (frame) return
  frame = requestAnimationFrame(() => { frame = 0; measure() })
}

let densityObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  readRowHeight()
  measure()
  findScroller()?.addEventListener('scroll', schedule, { passive: true })
  // 密度切换会改变行高，Token 变化后重算区间
  densityObserver = new MutationObserver(() => { readRowHeight(); schedule() })
  densityObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-density'] })
  resizeObserver = new ResizeObserver(schedule)
  if (table.value) resizeObserver.observe(table.value)
})

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  findScroller()?.removeEventListener('scroll', schedule)
  densityObserver?.disconnect()
  resizeObserver?.disconnect()
})

// 数据量或展开态变化后重新定位可视区间
watch(() => [flatRows.value.length, expanded.value.size], () => nextTick(schedule))

defineExpose({ expandAll, collapseAll })
</script>

<template>
  <div ref="wrap" class="table-wrap">
    <table
      ref="table"
      class="table"
      :style="minWidth ? { minWidth: `${minWidth}px` } : undefined"
      :aria-busy="loading"
      :aria-rowcount="virtualOn ? flatRows.length + 1 : undefined"
    >
      <thead>
        <tr>
          <th v-if="selectable" class="col-check">
            <Checkbox :model-value="allChecked" :indeterminate="someChecked" label="" @update:model-value="toggleAll" />
          </th>
          <th v-for="col in columns" :key="col.key" :class="col.className" :style="cellStyle(col)" scope="col">
            <span class="th-inner">{{ col.title }}</span>
          </th>
        </tr>
      </thead>
      <tbody ref="body">
        <template v-if="loading && !data.length">
          <tr v-for="i in 6" :key="`sk${i}`">
            <td v-if="selectable" class="col-check"><span class="skeleton" style="width: 17px; height: 17px; border-radius: 5px" /></td>
            <td v-for="(col, ci) in columns" :key="col.key">
              <span class="skeleton" :style="{ width: `${36 + ((i * 7 + ci * 13) % 48)}%` }" />
            </td>
          </tr>
        </template>
        <tr v-else-if="!flatRows.length">
          <td :colspan="colspan" style="height: auto"><EmptyState :title="emptyText" /></td>
        </tr>
        <template v-else>
          <tr v-if="padTop" class="virtual-pad" aria-hidden="true">
            <td :colspan="colspan" :style="{ height: `${padTop}px`, padding: 0, border: 0 }" />
          </tr>
          <tr
            v-for="item in visibleRows"
            :key="item.row[rowKey]"
            :class="['data-row', selected.includes(item.row[rowKey]) && 'is-selected']"
            :style="loading ? { opacity: .55 } : undefined"
            @click="emit('row-click', item.row)"
          >
            <td v-if="selectable" class="col-check">
              <Checkbox :model-value="selected.includes(item.row[rowKey])" @update:model-value="toggleRow(item.row[rowKey])" />
            </td>
            <td v-for="(col, ci) in columns" :key="col.key" :class="col.className" :style="{ textAlign: col.align }">
              <span v-if="tree && ci === 0" class="tree-cell" :style="{ paddingLeft: `${item.depth * 20}px` }">
                <button
                  type="button"
                  :class="['tree-toggle', !item.hasChildren && 'is-leaf', expanded.has(item.row[rowKey]) && 'is-open']"
                  :aria-label="expanded.has(item.row[rowKey]) ? '收起' : '展开'"
                  :aria-expanded="item.hasChildren ? expanded.has(item.row[rowKey]) : undefined"
                  :tabindex="item.hasChildren ? 0 : -1"
                  @click.stop="toggleExpand(item.row[rowKey])"
                ><Icon name="chevronRight" :size="14" /></button>
                <slot :name="`cell-${col.key}`" :row="item.row" :depth="item.depth">{{ item.row[col.key] }}</slot>
              </span>
              <slot v-else-if="$slots[`cell-${col.key}`]" :name="`cell-${col.key}`" :row="item.row" :depth="item.depth" />
              <span v-else class="cell-text" :title="String(item.row[col.key] ?? '')">{{ item.row[col.key] ?? '—' }}</span>
            </td>
          </tr>
          <tr v-if="padBottom" class="virtual-pad" aria-hidden="true">
            <td :colspan="colspan" :style="{ height: `${padBottom}px`, padding: 0, border: 0 }" />
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>