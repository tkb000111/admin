import type { RouteItem } from '../api/auth'
import type { FeatureNavFeature, FeatureNavModule, FeatureNavSection } from '../data'

/* ============================================================
   导航归一化：把 /auth/routes 返回的任意深度菜单树，
   归一化为「功能 → 小节? → 模块」结构，供双列导航消费。

   解读规则（对两种树形状天然成立，不做 UI 兼容开关）：
   - 有 component 的节点 = 页面菜单 → 模块；没有 component 的 = 目录容器。
   - 顶级目录 = 功能；功能第一层目录 = 小节标题；更深的目录并入当前小节；
     任何深度的页面菜单归入最近的容器（小节或功能直属）。
   - 顶级裸页面菜单（如未迁移库里的工作台）归入第一个功能的最前面；
     一个功能都没有时收进 fallbackLabel 的兜底功能，任何形状都不崩溃。
   本模块保持零运行时依赖（仅类型导入），便于单元测试。
   ============================================================ */

/** 路由名由路径推导：/system/user → system-user */
export function routeNameOf(path: string) {
  return path.replace(/^\/+|\/+$/g, '').replace(/\//g, '-') || 'home'
}

function normalizePath(path?: string) {
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}

export interface BuildFeatureNavOptions {
  /** 兜底功能名：树里只有裸页面菜单、没有任何目录时使用 */
  fallbackLabel?: string
  /** 页面过滤：component 标识已在前端登记（PAGE_MAP）才生成模块 */
  isPage?: (item: RouteItem) => boolean
}

function moduleOf(node: RouteItem, feature: string, section: string | undefined, options: BuildFeatureNavOptions): FeatureNavModule | null {
  const path = normalizePath(node.path)
  if (!path || !node.component) return null
  if (options.isPage && !options.isPage(node)) return null
  const module: FeatureNavModule = { key: routeNameOf(path), label: node.name, icon: node.icon || 'file', path, feature }
  if (section) module.section = section
  return module
}

/** 走进功能内部的容器层级：页面菜单挂进当前小节（无则挂功能直属） */
function collectInto(feature: FeatureNavFeature, nodes: RouteItem[], section: FeatureNavSection | undefined, options: BuildFeatureNavOptions) {
  for (const node of nodes) {
    if (node.component) {
      const module = moduleOf(node, feature.label, section?.label, options)
      if (module) (section ?? feature).modules.push(module)
      continue
    }
    const children = node.children ?? []
    if (!children.length) continue
    if (section) {
      // 更深的目录并入当前小节，不另起标题
      collectInto(feature, children, section, options)
      continue
    }
    const next: FeatureNavSection = { key: `section-${node.id ?? node.name}`, label: node.name, modules: [] }
    feature.sections.push(next)
    collectInto(feature, children, next, options)
  }
}

export function buildFeatureNav(tree: RouteItem[], options: BuildFeatureNavOptions = {}): FeatureNavFeature[] {
  const features: FeatureNavFeature[] = []
  const loose: FeatureNavModule[] = []

  for (const node of tree) {
    if (node.component) {
      // 顶级裸页面菜单（如未迁移库里的工作台）：先收着，最后归入第一个功能
      const module = moduleOf(node, '', undefined, options)
      if (module) loose.push(module)
      continue
    }
    const children = node.children ?? []
    if (!children.length) continue
    const feature: FeatureNavFeature = {
      key: `feature-${node.id ?? node.name}`,
      label: node.name,
      icon: node.icon || 'layers',
      modules: [],
      sections: [],
    }
    collectInto(feature, children, undefined, options)
    if (feature.modules.length || feature.sections.length) features.push(feature)
  }

  if (loose.length) {
    if (features.length) features[0].modules.unshift(...loose)
    else features.push({ key: 'feature-home', label: options.fallbackLabel ?? '导航', icon: 'layers', modules: [...loose], sections: [] })
  }

  // 丢掉空小节与没有任何模块的功能
  return features
    .map(f => ({ ...f, sections: f.sections.filter(s => s.modules.length) }))
    .filter(f => f.modules.length || f.sections.length)
}

/** 功能下的全部模块：直属模块在前，各小节模块随后 */
export function modulesOf(feature: FeatureNavFeature): FeatureNavModule[] {
  return [...feature.modules, ...feature.sections.flatMap(s => s.modules)]
}
