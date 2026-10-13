<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { tabs } from '@/composables/tabs'
import { motionSkipped, overlayEnter, overlayLeave } from '@/composables/motion'

/* ============================================================
   标签缓存行：双端同一套代码。
   横向滚动、激活高亮、单个关闭；行尾「更多」菜单提供
   刷新（踢出缓存重挂载）/ 关闭其他 / 关闭全部。
   激活标签变化时自动滚进可视区。
   浮层 Teleport 到 body（.content 是合成层，fixed 后代会被劫持）。
   ============================================================ */

const { list, active } = tabs

const scroller = ref<HTMLElement | null>(null)
const moreBtn = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const pos = ref({ top: 0, right: 0 })
const menuPop = ref<HTMLElement | null>(null)

const canCloseOthers = computed(() => list.value.length > 1)
const canRefresh = computed(() => Boolean(active.value))

function activateTab(path: string) {
  tabs.activate(path)
}

function closeTab(path: string) {
  tabs.close(path)
}

function openMenu() {
  const rect = moreBtn.value?.getBoundingClientRect()
  if (!rect) return
  pos.value = { top: rect.bottom + 6, right: window.innerWidth - rect.right }
  menuOpen.value = true
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onKey)
}

function closeMenu() {
  menuOpen.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey)
}

function onOutside(event: PointerEvent) {
  const target = event.target as Node
  if (moreBtn.value?.contains(target) || menuPop.value?.contains(target)) return
  closeMenu()
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

function pick(action: 'refresh' | 'close-others' | 'close-all') {
  closeMenu()
  if (action === 'refresh') void tabs.refresh()
  else if (action === 'close-others') tabs.closeOthers(active.value)
  else tabs.closeAll()
}

/* 激活标签自动滚进可视区 */
watch([active, () => list.value.length], () => {
  nextTick(() => {
    scroller.value?.querySelector<HTMLElement>('.tabbar-tab.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motionSkipped() ? 'auto' : 'smooth' })
  })
}, { immediate: true })

onBeforeUnmount(closeMenu)
</script>

<template>
  <div v-show="list.length" class="tabbar" role="tablist" aria-label="已打开页面">
    <div ref="scroller" class="tabbar-scroll">
      <div
        v-for="t in list"
        :key="t.path"
        role="tab"
        tabindex="0"
        :aria-selected="t.path === active"
        :class="['tabbar-tab', t.path === active && 'is-active']"
        :title="t.feature ? `${t.feature} · ${t.title}` : t.title"
        @click="activateTab(t.path)"
        @keydown.enter.prevent="activateTab(t.path)"
        @keydown.space.prevent="activateTab(t.path)"
      >
        <span class="tabbar-label">{{ t.title }}</span>
        <button type="button" class="tabbar-close" :aria-label="`关闭 ${t.title}`" @click.stop="closeTab(t.path)" @keydown.enter.stop>
          <Icon name="x" :size="11" />
        </button>
      </div>
    </div>
    <button ref="moreBtn" type="button" class="tabbar-more" aria-label="标签操作" :aria-expanded="menuOpen" @click="menuOpen ? closeMenu() : openMenu()">
      <Icon name="more" :size="15" />
    </button>

    <Teleport to="body">
      <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
        <div v-if="menuOpen" ref="menuPop" class="menu-pop m-float" role="menu" :style="{ top: `${pos.top}px`, right: `${pos.right}px` }">
          <button type="button" class="menu-item" role="menuitem" :disabled="!canRefresh" @click="pick('refresh')"><Icon name="refresh" :size="16" />刷新当前页</button>
          <button type="button" class="menu-item" role="menuitem" :disabled="!canCloseOthers" @click="pick('close-others')"><Icon name="minus" :size="16" />关闭其他标签</button>
          <button type="button" class="menu-item" role="menuitem" @click="pick('close-all')"><Icon name="ban" :size="16" />关闭全部标签</button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
