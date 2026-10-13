import { ref, type Ref } from 'vue'

/* ============================================================
   移动端外壳视图状态：≤820px 时整页在两个视图间切换（不做抽屉）。
   - 「界面」视图 = 顶栏 + 标签行 + 内容区，即当前打开的工作本身；
   - 「导航」视图 = 功能列 + 模块列两列同屏并排；
   - 默认落「界面」；任何路由跳转（导航点模块、深链、标签激活）
     都把视图带回「界面」——「当前打开的工作」是唯一真相源；
   - 回到大屏复位为「界面」：桌面双列常驻，没有视图概念。
   纯状态工厂，无组件依赖，便于单元测试。
   ============================================================ */

export type ShellView = 'interface' | 'navigate'

export interface ShellViewStore {
  view: Ref<ShellView>
  show(next: ShellView): void
  /** 路由变化（含深链跳转）：导航视图自动切回界面视图 */
  onRouteChanged(): void
  /** 断点变化：回到大屏复位界面视图；仍在小屏时保持当前视图 */
  onViewportChanged(isMobile: boolean): void
}

export function createShellView(): ShellViewStore {
  const view = ref<ShellView>('interface')

  function show(next: ShellView) {
    view.value = next
  }

  function onRouteChanged() {
    if (view.value === 'navigate') view.value = 'interface'
  }

  function onViewportChanged(isMobile: boolean) {
    if (!isMobile) view.value = 'interface'
  }

  return { view, show, onRouteChanged, onViewportChanged }
}
