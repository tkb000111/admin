<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { featureNav } from '@/composables/auth'
import { modulesOf } from '@/composables/featureNav'
import { slideThumb } from '@/composables/motion'

/* ============================================================
   双列导航：左功能列（主·深）+ 右模块列（次·浅）。
   交互语义（借自热铁盒工作台，机制走本项目的菜单表）：
   - 点功能 = 浏览：只切换右侧模块列，不冲掉已打开的界面；
   - 点模块 = 打开：内容区渲染并登记标签；已打开再点 = 激活过去。
   浏览位置与打开位置分叉记录、共同推导选中态。
   组件本身不做任何定位与断点假设（阶段四复用为移动并排视图）。
   ============================================================ */

const emit = defineEmits<{ (e: 'navigate'): void }>()

const route = useRoute()
const router = useRouter()

const rootEl = ref<HTMLElement | null>(null)
const featureListEl = ref<HTMLElement | null>(null)
const featureThumb = ref<HTMLElement | null>(null)
const moduleListEl = ref<HTMLElement | null>(null)
const moduleThumb = ref<HTMLElement | null>(null)

/** 浏览中的功能：决定模块列显示哪一组 */
const browseKey = ref('')

const browsed = computed(() => featureNav.value.find(f => f.key === browseKey.value) ?? null)
const activePath = computed(() => route.path)
const activeFeatureKey = computed(() =>
  featureNav.value.find(f => modulesOf(f).some(m => m.path === activePath.value))?.key ?? '')
/** 打开的模块属于当前浏览的功能时，模块列才显示激活滑块 */
const showModuleThumb = computed(() =>
  Boolean(browsed.value && activeFeatureKey.value && browsed.value.key === activeFeatureKey.value))

// 打开位置变化时浏览跟随过去；点别的功能只暂时分叉
watch(activeFeatureKey, (key) => { if (key) browseKey.value = key }, { immediate: true })
watch(featureNav, () => {
  if (!browsed.value && featureNav.value.length) browseKey.value = featureNav.value[0].key
})

function browse(key: string) {
  browseKey.value = key
}

function openModule(path: string) {
  emit('navigate')
  if (route.path !== path) router.push(path)
}

function syncFeatureThumb(instant = false) {
  const target = featureListEl.value?.querySelector<HTMLElement>('.fnav-feature.is-browse') ?? null
  slideThumb(featureThumb.value, target, 'y', instant)
}

function syncModuleThumb(instant = false) {
  const target = showModuleThumb.value
    ? moduleListEl.value?.querySelector<HTMLElement>('.fnav-module.is-active') ?? null
    : null
  slideThumb(moduleThumb.value, target, 'y', instant)
}

function sync(instant = false) {
  nextTick(() => {
    syncFeatureThumb(instant)
    syncModuleThumb(instant)
  })
}

let observer: ResizeObserver | null = null
onMounted(() => {
  sync(true)
  observer = new ResizeObserver(() => sync(true))
  if (rootEl.value) observer.observe(rootEl.value)
})
onBeforeUnmount(() => observer?.disconnect())

watch([browseKey, activePath, () => featureNav.value], () => sync(), { deep: true })
</script>

<template>
  <aside ref="rootEl" class="fnav m-rail">
    <nav ref="featureListEl" class="fnav-features" aria-label="功能导航">
      <span v-show="browsed" ref="featureThumb" class="fnav-thumb m-pill" aria-hidden="true" />
      <button
        v-for="f in featureNav"
        :key="f.key"
        type="button"
        :class="['fnav-feature', f.key === browseKey && 'is-browse', f.key === activeFeatureKey && 'is-open']"
        :title="f.label"
        @click="browse(f.key)"
      >
        <Icon class="fnav-ico" :name="f.icon" :size="16" />
        <span class="fnav-label">{{ f.label }}</span>
        <span v-if="f.key === activeFeatureKey" class="fnav-dot" aria-hidden="true" />
      </button>
    </nav>

    <section class="fnav-modules" aria-label="模块导航">
      <div v-if="browsed" class="fnav-modules-head">{{ browsed.label }}</div>
      <nav ref="moduleListEl" class="fnav-modules-list">
        <span v-show="showModuleThumb" ref="moduleThumb" class="fnav-thumb is-accent m-pill" aria-hidden="true" />
        <template v-if="browsed">
          <button
            v-for="m in browsed.modules"
            :key="m.key"
            type="button"
            :class="['fnav-module', m.path === activePath && 'is-active']"
            :aria-current="m.path === activePath ? 'page' : undefined"
            :title="m.label"
            @click="openModule(m.path)"
          >
            <Icon class="fnav-ico" :name="m.icon" :size="14" />
            <span class="fnav-label">{{ m.label }}</span>
          </button>
          <template v-for="s in browsed.sections" :key="s.key">
            <div class="fnav-section-title">{{ s.label }}</div>
            <button
              v-for="m in s.modules"
              :key="m.key"
              type="button"
              :class="['fnav-module', m.path === activePath && 'is-active']"
              :aria-current="m.path === activePath ? 'page' : undefined"
              :title="m.label"
              @click="openModule(m.path)"
            >
              <Icon class="fnav-ico" :name="m.icon" :size="14" />
              <span class="fnav-label">{{ m.label }}</span>
            </button>
          </template>
        </template>
        <div v-else class="fnav-empty faint">暂无可访问的模块</div>
      </nav>
    </section>
  </aside>
</template>
