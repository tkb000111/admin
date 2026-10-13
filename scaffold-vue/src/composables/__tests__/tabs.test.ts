import test from 'node:test'
import assert from 'node:assert/strict'
import { createTabsStore, type TabsRouter } from '../tabs.ts'

/* 内存 localStorage（与 api 会话测试同款） */
function memoryStorage() {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, value),
  }
}

/* 假路由器：push 命中已登记路由时触发 afterEach，模拟真实导航注册标签 */
function fakeRouter(routes: Record<string, { title: string; feature?: string }>) {
  const listeners: Array<(to: { path: string; name: string; meta: Record<string, unknown> }) => void> = []
  const pushes: Array<{ path: string; query?: Record<string, unknown> }> = []
  const metaOf = (path: string) => {
    const route = routes[path]
    if (!route) return null
    return { componentKey: path, title: route.title, feature: route.feature ?? '' }
  }
  const router = {
    push(target: { path: string; query?: Record<string, unknown> }) {
      pushes.push(target)
      const meta = metaOf(target.path)
      if (meta) listeners.forEach(fn => fn({ path: target.path, name: target.path.slice(1).replace(/\//g, '-'), meta }))
      return Promise.resolve()
    },
    resolve(path: string) {
      const meta = metaOf(path)
      return meta
        ? { matched: [{ path }], name: path.slice(1).replace(/\//g, '-'), meta, path }
        : { matched: [], meta: {}, path }
    },
    afterEach(fn: (to: { path: string; name: string; meta: Record<string, unknown> }) => void) {
      listeners.push(fn)
      return () => {}
    },
  }
  return { router: router as unknown as TabsRouter, pushes }
}

const ROUTES = {
  '/dashboard': { title: '工作台', feature: '后台管理' },
  '/system/user': { title: '用户管理', feature: '后台管理' },
  '/system/role': { title: '角色管理', feature: '后台管理' },
  '/system/menu': { title: '菜单管理', feature: '后台管理' },
}
const landing = () => '/dashboard'

function setup(storage = memoryStorage()) {
  const fake = fakeRouter(ROUTES)
  const tabs = createTabsStore({ router: fake.router, storage, landing })
  return { tabs, pushes: fake.pushes, storage }
}

test('导航注册标签：进入模块路由自动登记并激活，重复进入不重复登记', () => {
  const { tabs, pushes } = setup()
  tabs.open('/system/user')
  assert.deepEqual(pushes.map(p => p.path), ['/system/user'])
  assert.equal(tabs.list.value.length, 1)
  assert.equal(tabs.active.value, '/system/user')
  assert.equal(tabs.list.value[0].key, 'system-user')
  assert.equal(tabs.list.value[0].title, '用户管理')
  assert.equal(tabs.list.value[0].feature, '后台管理')

  tabs.open('/system/role')
  assert.equal(tabs.list.value.length, 2)
  tabs.open('/system/user')
  assert.equal(tabs.list.value.length, 2)
  assert.equal(tabs.active.value, '/system/user')
  // 已打开再点 = 激活过去：清单顺序不变
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/user', '/system/role'])
})

test('关闭当前标签激活邻居，关到最后一格回默认落点并重新登记', () => {
  const { tabs, pushes } = setup()
  tabs.open('/system/user')
  tabs.open('/system/role')
  tabs.open('/system/menu')
  assert.equal(tabs.active.value, '/system/menu')

  tabs.close('/system/menu')
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/user', '/system/role'])
  assert.equal(tabs.active.value, '/system/role')

  tabs.close('/system/user')
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/role'])
  assert.equal(tabs.active.value, '/system/role')

  tabs.close('/system/role')
  assert.equal(pushes.at(-1)?.path, '/dashboard')
  // 关到最后一格：导航回默认落点，落点路由随即登记为新标签并激活
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/dashboard'])
  assert.equal(tabs.active.value, '/dashboard')
})

test('关闭非当前标签不改变激活项；closeOthers 只留一格；closeAll 回落点', () => {
  const { tabs, pushes } = setup()
  tabs.open('/system/user')
  tabs.open('/system/role')
  tabs.open('/system/menu')

  tabs.close('/system/user')
  assert.equal(tabs.active.value, '/system/menu')
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/role', '/system/menu'])

  tabs.closeOthers('/system/role')
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/role'])
  assert.equal(tabs.active.value, '/system/role')

  tabs.open('/system/menu')
  tabs.closeAll()
  assert.equal(pushes.at(-1)?.path, '/dashboard')
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/dashboard'])
})

test('refresh 递增渲染键并短暂踢出缓存名单，未开标签刷新无副作用', async () => {
  const { tabs } = setup()
  tabs.open('/system/user')
  assert.equal(tabs.renderKey('/system/user'), '/system/user#0')
  assert.deepEqual([...tabs.include.value], ['system-user'])

  await tabs.refresh('/system/user')
  assert.equal(tabs.renderKey('/system/user'), '/system/user#1')
  // 下一拍缓存资格恢复，include 不泄漏
  assert.deepEqual([...tabs.include.value], ['system-user'])

  // 未打开的标签刷新：bust 不变、include 不动
  await tabs.refresh('/system/role')
  assert.equal(tabs.renderKey('/system/role'), '/system/role#0')
  assert.deepEqual([...tabs.include.value], ['system-user'])
})

test('恢复：按当前路由校验快照，失效条目丢弃，激活无效取第一个有效', () => {
  const storage = memoryStorage()
  storage.setItem('scaffold.tabs', JSON.stringify({
    list: [
      { key: 'system-user', path: '/system/user', title: '用户管理', feature: '后台管理' },
      { key: 'ghost', path: '/ghost/page', title: '已下线', feature: '' },
    ],
    active: '/ghost/page',
  }))
  const { tabs } = setup(storage)

  tabs.restore()
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/user'])
  assert.equal(tabs.active.value, '/system/user')
  assert.equal(tabs.restoredLanding(), '/system/user')
  // 恢复会写回清洗后的清单
  const saved = JSON.parse(storage.getItem('scaffold.tabs') ?? '{}')
  assert.deepEqual(saved.list.map((t: { path: string }) => t.path), ['/system/user'])
  assert.equal(saved.active, '/system/user')
})

test('恢复：全部失效清空并删除本地记忆；restore 每会话只执行一次', () => {
  const storage = memoryStorage()
  storage.setItem('scaffold.tabs', JSON.stringify({
    list: [{ key: 'ghost', path: '/ghost/page', title: '已下线', feature: '' }],
    active: '/ghost/page',
  }))
  const { tabs } = setup(storage)

  tabs.restore()
  assert.equal(tabs.list.value.length, 0)
  assert.equal(tabs.restoredLanding(), null)
  assert.equal(storage.getItem('scaffold.tabs'), null)

  // 第二次调用直接跳过（restored 标志）
  tabs.open('/system/user')
  tabs.restore()
  assert.equal(tabs.list.value.length, 1)
})

test('clear 清空内存但保留本地记忆，恢复标志复位后可再次恢复', () => {
  const { tabs, storage } = setup()
  tabs.open('/system/user')
  tabs.open('/system/role')

  tabs.clear()
  assert.equal(tabs.list.value.length, 0)
  assert.equal(tabs.active.value, '')
  // localStorage 保留（跨登录的记忆由下一次 restore 校验）
  assert.ok(storage.getItem('scaffold.tabs'))

  tabs.restore()
  assert.deepEqual(tabs.list.value.map(t => t.path), ['/system/user', '/system/role'])
  assert.equal(tabs.active.value, '/system/role')
})
