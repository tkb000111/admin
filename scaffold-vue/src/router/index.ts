import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { setUnauthorizedHandler } from '@/api'
import { authed, clearSession, dynamicRoutes, featureNav, loadRoutes, refreshUser, sessionVersion, setSessionRouteReset } from '@/composables/auth'
import { modulesOf } from '@/composables/featureNav'
import { tabs } from '@/composables/tabs'
import { pushToast } from '@/composables/toast'
import { APP } from '@/data'
import AppShell from '@/components/layout/AppShell.vue'

const staticRoutes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true, title: '登录' } },
  {
    path: '/',
    name: 'root',
    component: AppShell,
    children: [
      { path: 'no-access', name: 'no-access', component: () => import('@/views/NoAccess.vue'), meta: { title: '暂未分配菜单' } },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { title: '页面不存在' } },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes: staticRoutes,
})

let routesReady = false
let routeLoad: Promise<boolean> | null = null
let cancelRouteLoad: (() => void) | null = null
const removeRoutes: Array<() => void> = []

/** 登录后的默认落点：第一个功能的第一个模块（如「后台管理 · 工作台」），无菜单时去提示页 */
export function homePath() {
  const feature = featureNav.value[0]
  return (feature ? modulesOf(feature)[0]?.path : undefined) ?? '/no-access'
}

// 标签中心绑定真实路由：afterEach 里注册 / 激活标签，关到最后回到默认落点
tabs.bind(router, homePath)

export function resetRoutes() {
  removeRoutes.splice(0).forEach(remove => remove())
  routesReady = false
  cancelRouteLoad?.()
  cancelRouteLoad = null
  routeLoad = null
}
setSessionRouteReset(resetRoutes)

async function ensureRoutes() {
  if (routesReady) return true
  if (routeLoad) return routeLoad
  const version = sessionVersion.value
  const cancelled = new Promise<boolean>(resolve => { cancelRouteLoad = () => resolve(false) })
  const task = Promise.race([cancelled, (async () => {
    await Promise.all([loadRoutes(), refreshUser()])
    if (version !== sessionVersion.value || !authed.value) return false
    dynamicRoutes.value.forEach(route => removeRoutes.push(router.addRoute('root', route)))
    routesReady = true
    // 路由已注册：恢复上次打开的标签（按当前账号菜单校验，失效条目丢弃）
    tabs.restore()
    return true
  })()])
  routeLoad = task
  try {
    return await task
  } finally {
    if (routeLoad === task) {
      routeLoad = null
      cancelRouteLoad = null
    }
  }
}

router.beforeEach(async (to) => {
  if (to.meta.public) {
    return authed.value && to.name === 'login' ? { path: '/' } : true
  }
  if (!authed.value) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined }
  }
  if (!routesReady) {
    const version = sessionVersion.value
    try {
      if (!await ensureRoutes()) return false
    } catch {
      if (version !== sessionVersion.value) return false
      clearSession()
      pushToast('菜单加载失败，请重新登录', 'danger')
      return { name: 'login' }
    }
    // 动态路由刚注册：按原地址重新解析，保留查询参数（深链如 ?trace=user:1）
    return to.path === '/'
      ? { path: tabs.restoredLanding() ?? homePath(), replace: true }
      : { path: to.path, query: to.query, hash: to.hash, replace: true }
  }
  if (to.path === '/') {
    // 有恢复出的上次工作台面就回到那里，否则回默认落点
    return { path: tabs.restoredLanding() ?? homePath(), replace: true }
  }
  return true
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} · ${APP.name}` : APP.name
})

// 任一接口返回 401：清理登录态并回到登录页
let redirecting = false
setUnauthorizedHandler(() => {
  if (redirecting || !authed.value) return
  redirecting = true
  clearSession()
  pushToast('登录已过期，请重新登录', 'info')
  router.replace({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } }).finally(() => { redirecting = false })
})

export default router
