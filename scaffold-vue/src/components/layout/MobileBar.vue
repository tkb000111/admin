<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import type { ShellView } from '@/composables/shellView'

/* ============================================================
   移动端底部固定操作栏：最多 4 格。
   第 1 格「导航」= 功能列 + 模块列并排的导航视图；
   第 2 格「界面」= 当前打开的工作本身（顶栏 + 标签行 + 内容区），
   不是清单——切回即所见；
   第 3、4 格预留空位（视觉上明确是空位，点击无动作）。
   大屏整栏隐藏，样式见 layout.css 的 .mbar-*。
   ============================================================ */

defineProps<{ view: ShellView }>()

const emit = defineEmits<{ (e: 'select', view: ShellView): void }>()

const CELLS: Array<{ view: ShellView; icon: string; label: string }> = [
  { view: 'navigate', icon: 'grid', label: '导航' },
  { view: 'interface', icon: 'board', label: '界面' },
]
</script>

<template>
  <nav class="mbar" aria-label="视图切换">
    <button
      v-for="cell in CELLS"
      :key="cell.view"
      type="button"
      :class="['mbar-cell m-pill', view === cell.view && 'is-active']"
      :aria-current="view === cell.view ? 'true' : undefined"
      @click="emit('select', cell.view)"
    >
      <Icon :name="cell.icon" :size="16" />
      <span>{{ cell.label }}</span>
    </button>
    <div class="mbar-cell is-empty" aria-hidden="true" />
    <div class="mbar-cell is-empty" aria-hidden="true" />
  </nav>
</template>
