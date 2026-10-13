import { ref, type Component } from 'vue'
import type { RouteRecordRaw } from 'vue-router'
import {
  ApiError, authApi, authSession, portalApi, systemApi,
  type CurrentUser, type LoginRequest, type QueryParams, type PageResult, type RouteItem,
} from '@/api'
import { setPermissions } from '@/directives/permission'
import type { NavGroup, NavLeaf } from '@/data'
import { clearDictCache } from './dict'
import { clearDeptCache } from './dept'

/* ============================================================
   登录态、权限与动态菜单。
   菜单与路由完全来自后端 /api/auth/routes（sys_menu 表），
   前端只维护「组件路径 → 页面组件」的映射。
   ============================================================ */

export const authed = ref<boolean>(authSession.isAuthenticated())
export const currentUser = ref<CurrentUser | null>(authSession.user() as CurrentUser | null)
export const navGroups = ref<NavGroup[]>([])
export const dynamicRoutes = ref<RouteRecordRaw[]>([])
export const sessionVersion = ref(0)
/** 页面组件标识 → 当前账号可访问的路由路径（如 monitor/operlog/index → /monitor/operlog） */
export const componentPaths = ref<Record<string, string>>({})

/** 当前账号可访问时返回该页面路径，否则 null；跨页跳转统一走这里，避免写死菜单路径 */
export function pathOf(component: string) {
  return componentPaths.value[component] ?? null
}
let resetSessionRoutes: (() => void) | undefined

/** 由路由入口注册，外壳只通过 logout 清理会话，避免循环导入路由。 */
export function setSessionRouteReset(handler: () => void) {
  resetSessionRoutes = handler
}

// 刷新页面后先用本地缓存的权限，随后由 refreshUser() 以服务端为准
setPermissions(currentUser.value?.permissions ?? [])

/** 页面登记项：视图 + 取数 + 导出 + 形态，一个页面一条 */
export interface PageEntry {
  /** 页面组件：懒加载，构成独立代码分块 */
  view: () => Promise<{ default: Component }>
  /** 树型页面：不分页 */
  tree?: boolean
  /** 分页条数；不填用默认 10 */
  pageSize?: number
  /** 首次取数：参数须与页面挂载时发出的请求一致 */
  list?: (params: QueryParams) => Promise<PageResult<unknown>>
  /** 树型取数 */
  treeList?: (params: QueryParams) => Promise<unknown[]>
  /** 导出：与列表页导出按钮同源 */
  exportData?: (params: QueryParams) => Promise<Blob>
  /** 导出文件名；不填则不显示导出按钮 */
  exportName?: string
}

/**
 * 页面登记表（唯一声明源）
 * key 取自后端 sys_menu.component。
 * 新增页面（含插件页）在此登记一次：视图、取数方式、导出配置、形态。
 * 业务页内不再声明取数方式，统一由外壳按路由元信息取用。
 */
export const PAGE_MAP: Record<string, PageEntry> = {
  'dashboard/index': {
    view: () => import('@/views/Dashboard.vue'),
  },
  'system/user/index': {
    view: () => import('@/views/system/Users.vue'),
    list: params => systemApi.users.list(params),
    exportData: params => systemApi.users.export(params),
    exportName: '用户列表.csv',
  },
  'system/role/index': {
    view: () => import('@/views/system/Roles.vue'),
    list: params => systemApi.roles.list(params),
    exportData: params => systemApi.roles.export(params),
    exportName: '角色列表.csv',
  },
  'system/menu/index': {
    view: () => import('@/views/system/Menus.vue'),
    tree: true,
    treeList: params => systemApi.menus.tree(params),
    exportData: params => systemApi.menus.export(params),
    exportName: '菜单列表.csv',
  },
  'system/dept/index': {
    view: () => import('@/views/system/Depts.vue'),
    tree: true,
    treeList: params => systemApi.depts.tree(params),
    exportData: params => systemApi.depts.export(params),
    exportName: '部门列表.csv',
  },
  'system/post/index': {
    view: () => import('@/views/system/Posts.vue'),
    list: params => systemApi.posts.list(params),
    exportData: params => systemApi.posts.export(params),
    exportName: '岗位列表.csv',
  },
  'system/dict/index': {
    view: () => import('@/views/system/Dict.vue'),
    list: params => systemApi.dictTypes.list(params),
    exportData: params => systemApi.dictTypes.export(params),
    exportName: '字典类型.csv',
  },
  'system/config/index': {
    view: () => import('@/views/system/Configs.vue'),
    list: params => systemApi.configs.list(params),
    exportData: params => systemApi.configs.export(params),
    exportName: '参数配置.csv',
  },
  'monitor/operlog/index': {
    view: () => import('@/views/monitor/OperLog.vue'),
    list: params => systemApi.operLogs.list(params),
    exportData: params => systemApi.operLogs.export(params),
    exportName: '操作日志.csv',
  },
  'monitor/loginlog/index': {
    view: () => import('@/views/monitor/LoginLog.vue'),
    list: params => systemApi.loginLogs.list(params),
    exportData: params => systemApi.loginLogs.export(params),
    exportName: '登录日志.csv',
  },
  'tool/gen/index': {
    view: () => import('@/views/tool/Generator.vue'),
    list: params => portalApi.generator.tables.list(params),
  },
}

/** 组件标识 → 页面组件：由登记表派生，业务页不重复声明 */
const COMPONENT_MAP: Record<string, () => Promise<{ default: Component }>> = Object.fromEntries(
  Object.entries(PAGE_MAP).map(([key, entry]) => [key, entry.view]),
)

/** 路由名由路径推导：/system/user → system-user */
export function routeNameOf(path: string) {
  return path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'home'
}

function normalizePath(path?: string) {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

function leafOf(item: RouteItem): NavLeaf | null {
  const path = normalizePath(item.path)
  if (!path || !item.component || !COMPONENT_MAP[item.component]) return null
  return { key: routeNameOf(path), label: item.name, icon: item.icon || 'file', path }
}

function buildNav(tree: RouteItem[]): NavGroup[] {
  const groups: NavGroup[] = []
  for (const node of tree) {
    const children = node.children ?? []
    if (!children.length) {
      const leaf = leafOf(node)
      if (leaf) groups.push({ key: leaf.key, label: leaf.label, icon: leaf.icon, single: true, items: [leaf] })
      continue
    }
    const items = children.map(leafOf).filter((leaf): leaf is NavLeaf => Boolean(leaf))
    if (items.length) groups.push({ key: `group-${node.id ?? node.name}`, label: node.name, icon: node.icon || 'file', items })
  }
  return groups
}

function buildRoutes(groups: NavGroup[], tree: RouteItem[]): RouteRecordRaw[] {
  const componentByPath = new Map<string, string>()
  const walk = (nodes: RouteItem[]) => nodes.forEach(node => {
    if (node.path && node.component) componentByPath.set(normalizePath(node.path), node.component)
    walk(node.children ?? [])
  })
  walk(tree)
  return groups.flatMap(group => group.items.map(item => ({
    path: item.path.replace(/^\//, ''),
    name: item.key,
    component: COMPONENT_MAP[componentByPath.get(item.path) ?? ''],
    // componentKey 是「页面 ↔ 数据契约」的连接键，外壳据此预取
    meta: { title: item.label, group: group.single ? undefined : group.label, componentKey: componentByPath.get(item.path) ?? '' },
  })))
}

export async function loadRoutes() {
  const version = sessionVersion.value
  const data = await authApi.routes()
  if (version !== sessionVersion.value) return
  const groups = buildNav(data.routes)
  navGroups.value = groups
  dynamicRoutes.value = buildRoutes(groups, data.routes)
  const visible = new Set(groups.flatMap(group => group.items.map(item => item.path)))
  const paths: Record<string, string> = {}
  const walk = (nodes: RouteItem[]) => nodes.forEach(node => {
    const path = normalizePath(node.path)
    if (node.component && visible.has(path)) paths[node.component] = path
    walk(node.children ?? [])
  })
  walk(data.routes)
  componentPaths.value = paths
}

/** 以服务端为准刷新当前用户与权限码 */
export async function refreshUser() {
  const version = sessionVersion.value
  const user = await authApi.me()
  if (version !== sessionVersion.value) return user
  currentUser.value = user
  setPermissions(user.permissions ?? [])
  const token = authSession.token()
  if (token) authSession.save({ token, expiresIn: remainingSeconds() }, user, authSession.isRemembered())
  return user
}

function remainingSeconds() {
  return Math.max(60, Math.round((authSession.expiresAt() - Date.now()) / 1000))
}

export async function login(credentials: LoginRequest, remember: boolean) {
  clearSession()
  const version = sessionVersion.value
  try {
    const loginResponse = await authApi.login(credentials)
    if (version !== sessionVersion.value) throw new Error('登录状态已变化，请重新登录')
    authSession.save(loginResponse, { username: credentials.username, nickname: credentials.username }, remember)
    const user = await authApi.me()
    if (version !== sessionVersion.value) throw new Error('登录状态已变化，请重新登录')
    authSession.save(loginResponse, user, remember)
    currentUser.value = user
    setPermissions(user.permissions ?? [])
    authed.value = true
    return user
  } catch (error) {
    if (version === sessionVersion.value) clearSession()
    throw error
  }
}

export function clearSession() {
  sessionVersion.value += 1
  authed.value = false
  resetSessionRoutes?.()
  currentUser.value = null
  navGroups.value = []
  dynamicRoutes.value = []
  componentPaths.value = {}
  setPermissions([])
  authSession.clear()
  clearDictCache()
  clearDeptCache()
}

export async function logout() {
  // 先捕获旧 token 发出退出请求，再同步清理；慢请求不能留下旧菜单或清掉新会话。
  const task = authSession.isAuthenticated() ? authApi.logout() : Promise.resolve()
  clearSession()
  try {
    await task
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 401)) console.warn('logout failed', error)
  }
}
