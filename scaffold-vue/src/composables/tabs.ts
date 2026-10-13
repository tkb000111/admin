import { computed, nextTick, reactive, ref, type ComputedRef, type Ref } from 'vue'
import type { LocationQueryRaw } from 'vue-router'

/* ============================================================
   标签缓存状态中心：「当前打开的工作」是唯一真相源。
   - 打开 / 激活 / 关闭 / 关闭其他 / 关闭全部 / 刷新 / 恢复；
   - 列表持久化到 localStorage，登录（路由就绪）后恢复上次标签；
     只恢复标签清单与激活项，不恢复页内状态；恢复不了的条目丢弃，
     全部失效时回退默认落点；
   - KeepAlive 的 include 名单由此派生（key = 路由名 = 页面缓存名）；
   - 标签注册由路由 afterEach 驱动：任何方式进入模块路由
     （导航、命令面板、深链）都会生成或激活对应标签；
     无菜单页（no-access / 404）没有 componentKey，不进标签体系。
   ============================================================ */

const STORAGE_KEY = 'scaffold.tabs'

export interface TabItem {
  /** 路由名，同时是 KeepAlive 缓存名 */
  key: string
  path: string
  title: string
  /** 所属功能名（面包屑与展示用） */
  feature: string
}

export interface TabsSnapshot {
  list: TabItem[]
  active: string
}

/** 结构化路由依赖：真实 Router 与测试桩都满足此形状 */
export interface TabsRouter {
  push(target: { path: string; query?: LocationQueryRaw }): unknown
  resolve(path: string): { matched: unknown[]; name?: unknown; meta: Record<string, unknown>; path: string }
  afterEach(fn: (to: { path: string; name?: unknown; meta: Record<string, unknown> }) => void): void
}

export interface TabsDeps {
  router?: TabsRouter
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  /** 关到最后一格时的默认落点（第一个功能的第一个模块） */
  landing?: () => string
}

export interface TabsStore {
  list: Ref<TabItem[]>
  active: Ref<string>
  /** KeepAlive include 名单：已开标签的缓存名，刷新中的名字短暂移出 */
  include: ComputedRef<string[]>
  /** 打开（已开则激活过去）；query 仅供深链使用 */
  open(target: string | { path: string; query?: Record<string, string> }): void
  /** 激活已开标签（与 open 同一行为：点导航 = 激活过去） */
  activate(path: string): void
  close(path: string): void
  closeOthers(path: string): void
  closeAll(): void
  /** 踢出缓存重挂载，回到页顶；不传则刷新当前激活标签 */
  refresh(path?: string): Promise<void>
  /** 内容区渲染键：路径稳定，仅刷新动作时变化以触发重挂载 */
  renderKey(path: string): string
  /** 路由就绪后恢复上次标签（每会话一次；clear 后可再次恢复） */
  restore(): void
  /** 登录落点：恢复出的激活标签路径，没有则 null（由调用方回退默认落点） */
  restoredLanding(): string | null
  /** 会话清理：清空内存状态；本地记忆保留，下次登录按新账号菜单重新校验恢复 */
  clear(): void
  bind(router: TabsRouter, landing: () => string): void
}

export function createTabsStore(deps: TabsDeps = {}): TabsStore {
  const storage = deps.storage
  const list = ref<TabItem[]>([])
  const active = ref('')
  /** 刷新 / 关闭时短暂移出缓存名单，等实例销毁后恢复 */
  const excluded = ref<Set<string>>(new Set())
  const busts = reactive<Record<string, number>>({})
  let router: TabsRouter | undefined = deps.router
  let landing: (() => string) | undefined = deps.landing
  let restored = false

  const include = computed(() => list.value.filter(t => !excluded.value.has(t.key)).map(t => t.key))

  function persist() {
    if (!storage) return
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ list: list.value, active: active.value }))
    } catch { /* 存储不可用时静默 */ }
  }

  /** 把缓存名短暂移出 include：cached 实例被销毁，一拍之后恢复资格 */
  function kickCache(key: string) {
    excluded.value = new Set([...excluded.value, key])
    void nextTick(() => {
      excluded.value = new Set([...excluded.value].filter(k => k !== key))
    })
  }

  /** 路由 afterEach 驱动的注册：模块路由生成 / 激活标签 */
  function registerRoute(to: { path: string; name?: unknown; meta: Record<string, unknown> }) {
    if (!to.meta || !to.meta.componentKey) return
    const path = to.path
    const existing = list.value.find(t => t.path === path)
    if (existing) {
      active.value = path
      persist()
      return
    }
    list.value = [...list.value, {
      key: String(to.name ?? ''),
      path,
      title: String(to.meta.title ?? path),
      feature: String(to.meta.feature ?? ''),
    }]
    active.value = path
    persist()
  }

  function open(target: string | { path: string; query?: Record<string, string> }) {
    if (!router) return
    const location = typeof target === 'string' ? { path: target } : target
    void router.push({ path: location.path, query: location.query })
  }

  function close(path: string) {
    const index = list.value.findIndex(t => t.path === path)
    if (index < 0) return
    const removed = list.value[index]
    const neighbor = list.value[index + 1] ?? list.value[index - 1]
    list.value = list.value.filter(t => t.path !== path)
    kickCache(removed.key)
    if (active.value === path) {
      if (neighbor) {
        active.value = neighbor.path
        open(neighbor.path)
      } else {
        active.value = ''
        open(landing ? landing() : '/')
      }
    }
    persist()
  }

  function closeOthers(path: string) {
    const keep = list.value.find(t => t.path === path)
    if (!keep) return
    list.value.filter(t => t.path !== path).forEach(t => kickCache(t.key))
    list.value = [keep]
    active.value = path
    if (active.value) open(path)
    persist()
  }

  function closeAll() {
    list.value.forEach(t => kickCache(t.key))
    list.value = []
    active.value = ''
    open(landing ? landing() : '/')
    persist()
  }

  async function refresh(path?: string): Promise<void> {
    const target = path ?? active.value
    const tab = list.value.find(t => t.path === target)
    if (!tab) return
    busts[target] = (busts[target] ?? 0) + 1
    kickCache(tab.key)
    await nextTick()
  }

  function renderKey(path: string) {
    return `${path}#${busts[path] ?? 0}`
  }

  function readSnapshot(): TabsSnapshot | null {
    if (!storage) return null
    try {
      const raw = storage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as TabsSnapshot
      if (!parsed || !Array.isArray(parsed.list)) return null
      return parsed
    } catch {
      return null
    }
  }

  function restore() {
    if (restored || !router) return
    const snapshot = readSnapshot()
    if (!snapshot) {
      restored = true
      return
    }
    const valid: TabItem[] = []
    for (const item of snapshot.list) {
      const path = item?.path
      if (typeof path !== 'string' || !path.startsWith('/')) continue
      const resolved = router.resolve(path)
      if (!resolved.matched.length || !resolved.meta || !resolved.meta.componentKey) continue
      valid.push({
        key: String(resolved.name ?? ''),
        path: resolved.path,
        title: String(item.title ?? resolved.path),
        feature: String(item.feature ?? ''),
      })
    }
    restored = true
    if (!valid.length) {
      try { storage?.removeItem(STORAGE_KEY) } catch { /* 忽略 */ }
      return
    }
    list.value = valid
    active.value = valid.some(t => t.path === snapshot.active) ? snapshot.active : valid[0].path
    persist()
  }

  function restoredLanding(): string | null {
    return list.value.length ? active.value : null
  }

  function clear() {
    list.value = []
    active.value = ''
    excluded.value = new Set()
    Object.keys(busts).forEach(key => delete busts[key])
    restored = false
  }

  function bind(nextRouter: TabsRouter, nextLanding: () => string) {
    router = nextRouter
    landing = nextLanding
    nextRouter.afterEach(registerRoute)
  }

  if (deps.router) bind(deps.router, deps.landing ?? (() => '/'))

  return {
    list, active, include,
    open, activate: open, close, closeOthers, closeAll, refresh, renderKey,
    restore, restoredLanding, clear, bind,
  }
}

/** 外壳唯一的标签中心；路由由 router/index.ts 绑定进来 */
export const tabs = createTabsStore(
  typeof localStorage !== 'undefined' ? { storage: localStorage } : {},
)
