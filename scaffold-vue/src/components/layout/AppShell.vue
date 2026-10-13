<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FeatureNav from './FeatureNav.vue'
import TabBar from './TabBar.vue'
import Topbar from './Topbar.vue'
import MobileBar from './MobileBar.vue'
import CommandPalette from './CommandPalette.vue'
import AppearanceDialog from './AppearanceDialog.vue'
import PasswordDialog from './PasswordDialog.vue'
import { logout } from '@/composables/auth'
import { tabs } from '@/composables/tabs'
import { createShellView, type ShellView } from '@/composables/shellView'
import { pageEnter, pageLeave, playShellEntrance, viewEnter } from '@/composables/motion'
import { confirm } from '@/composables/confirm'

/* ============================================================
   外壳装配：顶栏拉通占满一行（logo 在此），下方才是 导航 | 工作区。
   工作区 = 标签缓存行 + 内容区；内容区 = RouterView → Transition →
   KeepAlive 官方嵌套，缓存名单来自标签中心（标签开着 = 页面在缓存里）。
   双端唯一差异只有两处（00-初步思路 第六节）：
   1. 导航挂载点——大屏常驻左栏；小屏收进「导航」视图（两列并排）；
   2. 底部栏——小屏 4 格操作栏，大屏没有。
   工作区（含标签行）双端完全同源；≤820 整页切换两视图，不做抽屉。
   ============================================================ */

const { include, renderKey } = tabs

const route = useRoute()
const router = useRouter()
const shell = createShellView()
const frame = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const workspace = ref<HTMLElement | null>(null)
const mnav = ref<HTMLElement | null>(null)
const mobile = ref(false)
const commandOpen = ref(false)
const appearanceOpen = ref(false)
const passwordOpen = ref(false)
const scrolled = ref(false)

// 内容滚动后顶栏凝结：只切换一层静态玻璃的 opacity，不补间 backdrop-filter
function onContentScroll() {
  const next = (content.value?.scrollTop ?? 0) > 8
  if (next !== scrolled.value) scrolled.value = next
}

// 换页 / 刷新重挂载后回到页顶
function onAfterLeave() {
  content?.value?.scrollTo({ top: 0 })
  scrolled.value = false
}

const mq = window.matchMedia('(max-width: 820px)')
const syncMobile = () => {
  mobile.value = mq.matches
  shell.onViewportChanged(mobile.value)
}

function showInterface() {
  shell.show('interface')
}

function selectView(next: ShellView) {
  shell.show(next)
}

async function onLogout() {
  const ok = await confirm({ title: '退出登录', message: '确认退出当前账号吗？', confirmText: '退出' })
  if (!ok) return
  const task = logout()
  await router.replace({ name: 'login' })
  await task
}

function onCommandAction(name: 'appearance' | 'password' | 'logout') {
  if (name === 'appearance') appearanceOpen.value = true
  else if (name === 'password') passwordOpen.value = true
  else onLogout()
}

function onGlobalKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    commandOpen.value = !commandOpen.value
  }
}

// 任何路由跳转（导航点模块、深链如泳道跳日志、标签激活）都把移动视图带回「界面」
watch(() => route.fullPath, () => shell.onRouteChanged())

// 视图切换：整页轻淡入
watch(shell.view, (next) => {
  void nextTick(() => {
    const el = next === 'navigate' ? mnav.value : workspace.value
    if (el) viewEnter(el)
  })
})

onMounted(() => {
  syncMobile()
  mq.addEventListener('change', syncMobile)
  document.addEventListener('keydown', onGlobalKey)
  if (frame.value) playShellEntrance(frame.value)
})
onBeforeUnmount(() => {
  mq.removeEventListener('change', syncMobile)
  document.removeEventListener('keydown', onGlobalKey)
})
</script>

<template>
  <div class="stage">
    <div ref="frame" class="app-frame">
      <!-- 顶栏：拉通占满一行，logo 在此；下方才是 导航 | 工作区 两块 -->
      <Topbar
        @command="commandOpen = true"
        @appearance="appearanceOpen = true"
        @password="passwordOpen = true"
        @logout="onLogout"
      />
      <!-- 导航挂载点：大屏常驻左栏 -->
      <FeatureNav v-if="!mobile" />
      <!-- 小屏「导航」视图：双列并排（复用同一组件） -->
      <div v-if="mobile" v-show="shell.view.value === 'navigate'" ref="mnav" class="mnav">
        <FeatureNav @navigate="showInterface" />
      </div>
      <!-- 工作区：标签行 + 内容区，双端同源；小屏即「界面」视图 -->
      <div v-show="!mobile || shell.view.value === 'interface'" ref="workspace" :class="['workspace', { 'is-scrolled': scrolled }]">
        <TabBar />
        <main ref="content" class="content" tabindex="-1" @scroll.passive="onContentScroll">
          <RouterView v-slot="{ Component, route: viewRoute }">
            <Transition
              mode="out-in"
              :css="false"
              appear
              @leave="pageLeave"
              @after-leave="onAfterLeave"
              @enter="pageEnter"
            >
              <KeepAlive :include="include">
                <component :is="Component" :key="renderKey(viewRoute.path)" />
              </KeepAlive>
            </Transition>
          </RouterView>
        </main>
      </div>
      <!-- 底部操作栏：仅小屏 -->
      <MobileBar :view="shell.view.value" @select="selectView" />
    </div>
    <CommandPalette :open="commandOpen" @close="commandOpen = false" @action="onCommandAction" />
    <AppearanceDialog :open="appearanceOpen" @close="appearanceOpen = false" />
    <PasswordDialog :open="passwordOpen" @close="passwordOpen = false" />
  </div>
</template>
