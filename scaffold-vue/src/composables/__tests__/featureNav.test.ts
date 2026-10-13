import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFeatureNav, modulesOf, routeNameOf } from '../featureNav.ts'
import type { RouteItem } from '../../api/auth.ts'

function dir(id: number, name: string, children: RouteItem[]): RouteItem {
  return { id, name, children }
}

function menu(id: number, name: string, path: string, component: string, icon?: string): RouteItem {
  return { id, name, path, component, icon }
}

test('新库三级树：根目录 → 裸工作台 + 目录小节 → 模块，深层目录并入小节', () => {
  const tree: RouteItem[] = [
    dir(900, '后台管理', [
      menu(1, '工作台', '/dashboard', 'dashboard/index', 'dashboard'),
      dir(100, '系统管理', [
        menu(110, '用户管理', '/system/user', 'system/user/index', 'users'),
        menu(120, '角色管理', '/system/role', 'system/role/index', 'role'),
        dir(130, '日志管理', [
          menu(131, '操作日志', '/monitor/operlog', 'monitor/operlog/index', 'log'),
        ]),
      ]),
    ]),
  ]

  const nav = buildFeatureNav(tree)
  assert.equal(nav.length, 1)
  const feature = nav[0]
  assert.equal(feature.label, '后台管理')

  // 工作台是功能直属的第一个模块 → 登录默认落点
  assert.equal(feature.modules.length, 1)
  assert.equal(feature.modules[0].path, '/dashboard')
  assert.equal(feature.modules[0].key, 'dashboard')

  // 系统管理是小节标题；更深的「日志管理」不另起小节
  assert.equal(feature.sections.length, 1)
  const section = feature.sections[0]
  assert.equal(section.label, '系统管理')
  assert.equal(section.modules.length, 3)
  assert.ok(section.modules.every(m => m.section === '系统管理'))
  assert.equal(section.modules[2].path, '/monitor/operlog')

  // modulesOf：直属在前、小节随后
  assert.deepEqual(modulesOf(feature).map(m => m.path), ['/dashboard', '/system/user', '/system/role', '/monitor/operlog'])
})

test('未迁移旧库两级树：顶级裸菜单归入第一个功能最前', () => {
  const tree: RouteItem[] = [
    menu(1, '工作台', '/dashboard', 'dashboard/index', 'dashboard'),
    dir(100, '系统管理', [
      menu(110, '用户管理', '/system/user', 'system/user/index', 'users'),
      menu(120, '角色管理', '/system/role', 'system/role/index', 'role'),
    ]),
  ]

  const nav = buildFeatureNav(tree)
  assert.equal(nav.length, 1)
  const feature = nav[0]
  assert.equal(feature.label, '系统管理')
  assert.equal(feature.sections.length, 0)
  // 裸菜单在工作台规则下排最前，默认落点仍是工作台
  assert.deepEqual(modulesOf(feature).map(m => m.path), ['/dashboard', '/system/user', '/system/role'])
})

test('只有裸页面菜单时收进兜底功能', () => {
  const nav = buildFeatureNav(
    [menu(1, '工作台', '/dashboard', 'dashboard/index')],
    { fallbackLabel: '演示系统' },
  )
  assert.equal(nav.length, 1)
  assert.equal(nav[0].label, '演示系统')
  assert.equal(nav[0].modules[0].path, '/dashboard')
})

test('isPage 过滤：component 未登记的菜单不生成模块，连带清掉空小节与空功能', () => {
  const tree: RouteItem[] = [
    dir(100, '系统管理', [
      menu(110, '用户管理', '/system/user', 'system/user/index'),
      menu(120, '隐藏页', '/hidden/page', 'hidden/not-registered'),
    ]),
    dir(200, '空壳功能', [
      menu(210, '未登记页', '/ghost/page', 'ghost/index'),
    ]),
  ]

  const nav = buildFeatureNav(tree, { isPage: item => item.component !== 'hidden/not-registered' && item.component !== 'ghost/index' })
  assert.equal(nav.length, 1)
  assert.equal(nav[0].label, '系统管理')
  // 系统管理本身就是功能，登记的页面进直属模块；空壳功能整条被清掉
  assert.equal(nav[0].modules.length, 1)
  assert.equal(nav[0].modules[0].path, '/system/user')
  assert.equal(nav[0].sections.length, 0)
})

test('全部被过滤与空树都返回空列表，不崩溃', () => {
  const tree: RouteItem[] = [dir(100, '系统管理', [menu(110, '用户管理', '/system/user', 'system/user/index')])]
  assert.deepEqual(buildFeatureNav(tree, { isPage: () => false }), [])
  assert.deepEqual(buildFeatureNav([]), [])
  // 没有 children 的目录被忽略
  assert.deepEqual(buildFeatureNav([{ id: 300, name: '空目录' }]), [])
})

test('routeNameOf：路径 → 路由名 / 缓存名', () => {
  assert.equal(routeNameOf('/system/user'), 'system-user')
  assert.equal(routeNameOf('/dashboard'), 'dashboard')
  assert.equal(routeNameOf('system/user/'), 'system-user')
  assert.equal(routeNameOf('/'), 'home')
})
