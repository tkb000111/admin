/* ============================================================
   品牌与全局配置：换品牌只改这里。
   ============================================================ */
export const APP = Object.freeze({
  name: '通用后台管理系统',
  shortName: '管理后台',
  subtitle: 'Admin Console',
  version: 'v1.0.0',
  copyright: `© ${new Date().getFullYear()} 通用后台管理系统`,
})

/* ── 导航 ─────────────────────────────────────────────────── */
export interface NavLeaf {
  key: string
  label: string
  icon: string
  path: string
}

export interface NavGroup {
  key: string
  label: string
  icon: string
  /** 顶层单页菜单（如工作台）没有分组标题 */
  single?: boolean
  items: NavLeaf[]
}

/* ── 双列导航：功能 → 小节? → 模块（由 /auth/routes 树归一化而来） ── */

/** 模块：模块列里可点开的一个页面 */
export interface FeatureNavModule {
  /** 路由名（由路径推导），同时是 KeepAlive 缓存名 */
  key: string
  label: string
  icon: string
  path: string
  /** 所属功能名（供标签与面包屑） */
  feature: string
  /** 所属小节名；功能直属模块（如工作台）没有小节 */
  section?: string
}

/** 小节：模块列内不可点的视觉分组标题（如系统管理 / 监控 / 工具） */
export interface FeatureNavSection {
  key: string
  label: string
  modules: FeatureNavModule[]
}

/** 功能：功能列里可点的一项；点它只切换模块列（浏览），不打开页面 */
export interface FeatureNavFeature {
  key: string
  label: string
  icon: string
  /** 功能直属模块（无小节），渲染在小节之前 */
  modules: FeatureNavModule[]
  sections: FeatureNavSection[]
}

/* ── 业务行类型（与后端返回字段对应） ─────────────────────── */
export interface BaseRow {
  id: number
  status: number
  createTime?: string
  [key: string]: any
}

export interface Menu extends BaseRow {
  name: string
  parentId: number
  type: 'dir' | 'menu' | 'btn'
  icon?: string
  path?: string
  component?: string
  permission?: string
  visible?: number
  sort?: number
  children?: Menu[]
}

export interface Dept extends BaseRow {
  name: string
  parentId: number
  leader?: string
  phone?: string
  email?: string
  sort?: number
  memberCount?: number
  children?: Dept[]
}

/** 头像底色：由名称稳定映射，避免同一个人每次颜色不同 */
export const AVATAR_TINTS = ['#236de9', '#3f9d3a', '#4b5a63', '#2f8f9d', '#7a5cd6', '#c2603e']
