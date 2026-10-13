import test from 'node:test'
import assert from 'node:assert/strict'
import { createShellView } from '../shellView.ts'

test('默认落在界面视图，可显式切换到导航视图再切回', () => {
  const shell = createShellView()
  assert.equal(shell.view.value, 'interface')
  shell.show('navigate')
  assert.equal(shell.view.value, 'navigate')
  shell.show('interface')
  assert.equal(shell.view.value, 'interface')
})

test('路由变化（深链跳转）时导航视图自动切回界面视图', () => {
  const shell = createShellView()
  shell.show('navigate')
  shell.onRouteChanged()
  assert.equal(shell.view.value, 'interface')
  // 已在界面视图时路由变化不产生副作用
  shell.onRouteChanged()
  assert.equal(shell.view.value, 'interface')
})

test('断点回到大屏复位界面视图；仍在小屏时保持当前视图', () => {
  const shell = createShellView()
  shell.show('navigate')
  shell.onViewportChanged(true)
  assert.equal(shell.view.value, 'navigate')
  // 拉宽窗口跨过断点：桌面双列常驻，视图概念失效，复位为界面
  shell.onViewportChanged(false)
  assert.equal(shell.view.value, 'interface')
})
