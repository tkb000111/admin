<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { currentUser } from '@/composables/auth'
import { overlayEnter, overlayLeave } from '@/composables/motion'
import { APP } from '@/data'

const emit = defineEmits<{
  (e: 'command'): void
  (e: 'appearance'): void
  (e: 'password'): void
  (e: 'logout'): void
}>()

const route = useRoute()
const chip = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const pos = ref({ top: 0, right: 0 })

const feature = computed(() => route.meta.feature as string | undefined)
const title = computed(() => route.meta.title as string | undefined)

async function openMenu() {
  const rect = chip.value?.getBoundingClientRect()
  if (!rect) return
  pos.value = { top: rect.bottom + 8, right: window.innerWidth - rect.right }
  menuOpen.value = true
  await nextTick()
  pop.value?.querySelector<HTMLElement>('.menu-item')?.focus()
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('keydown', onKey)
}

function closeMenu(refocus = false) {
  menuOpen.value = false
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('keydown', onKey)
  if (refocus) chip.value?.focus()
}

function onOutside(event: PointerEvent) {
  const target = event.target as Node
  if (chip.value?.contains(target) || pop.value?.contains(target)) return
  closeMenu()
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu(true)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const items = Array.from(pop.value?.querySelectorAll<HTMLElement>('.menu-item') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
    next?.focus()
  }
}

function pick(action: 'command' | 'appearance' | 'password' | 'logout') {
  closeMenu()
  if (action === 'command') emit('command')
  else if (action === 'appearance') emit('appearance')
  else if (action === 'password') emit('password')
  else emit('logout')
}

onBeforeUnmount(() => closeMenu())
</script>

<template>
  <header class="topbar">
    <!-- 品牌（logo）：横跨全宽的顶栏最左 -->
    <div class="brand-box" :title="`${APP.subtitle} · ${APP.version}`">
      <span class="brand-mark" aria-hidden="true"><span class="brand-dot" /></span>
      <span class="brand-name">{{ APP.shortName }}</span>
    </div>
    <div class="crumbs" aria-label="当前位置">
      <template v-if="feature"><span class="crumb-parent">{{ feature }}</span><Icon class="crumb-sep" name="chevronRight" :size="10" /></template>
      <span class="crumb-current">{{ title }}</span>
    </div>
    <div class="spacer" />
    <button type="button" class="cmd-trigger m-pill" aria-label="搜索菜单" title="搜索菜单（⌘K）" @click="emit('command')">
      <Icon name="search" :size="14" />
    </button>
    <IconButton class="appearance-toggle" name="contrast" label="外观设置" @click="emit('appearance')" />
    <button
      ref="chip"
      type="button"
      class="user-chip"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click="menuOpen ? closeMenu() : openMenu()"
    >
      <Avatar :name="currentUser?.nickname" :size="22" />
      <Icon name="chevronDown" :size="12" style="color: var(--ink-soft)" />
    </button>

    <Teleport to="body">
      <Transition :css="false" @enter="(el, done) => overlayEnter(el, done, 'pop')" @leave="(el, done) => overlayLeave(el, done, 'pop')">
        <div v-if="menuOpen" ref="pop" class="menu-pop m-float" role="menu" :style="{ top: `${pos.top}px`, right: `${pos.right}px` }">
          <div class="menu-head">
            <div style="font-weight: 680">{{ currentUser?.nickname }}</div>
            <div class="soft" style="font-size: 12px">@{{ currentUser?.username }}<template v-if="currentUser?.deptName"> · {{ currentUser.deptName }}</template></div>
          </div>
          <button type="button" class="menu-item" role="menuitem" @click="pick('command')"><Icon name="search" :size="16" />搜索菜单</button>
          <button type="button" class="menu-item" role="menuitem" @click="pick('password')"><Icon name="key" :size="16" />修改密码</button>
          <button type="button" class="menu-item" role="menuitem" @click="pick('appearance')"><Icon name="contrast" :size="16" />外观设置</button>
          <button type="button" class="menu-item is-danger" role="menuitem" @click="pick('logout')"><Icon name="logout" :size="16" />退出登录</button>
        </div>
      </Transition>
    </Teleport>
  </header>
</template>
