import { reactive, ref, shallowRef, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import type { PageResult, QueryParams } from '@/api'
import { downloadBlob } from '@/utils/download'
import { PAGE_MAP, type PageEntry } from './auth'
import { pushToast, toastError } from './toast'

/* ============================================================
   列表页通用逻辑：查询、重置、服务端分页、导出、勾选。

   页面只声明三件事：查询字段初始值、列定义、单元格插槽。
   取数与导出方式由 auth.ts 的页面登记表按组件标识统一提供，
   页面内不重复声明。
   ============================================================ */

export interface ListPageOptions<Row, Query extends Record<string, unknown>> {
  /** 查询字段初始值，重置时回到这里 */
  query: Query
  /**
   * 取数函数。留空则按 loaderKey（默认取当前路由的组件标识）
   * 从页面登记表自动取用，避免同一件事声明两处。
   */
  fetch?: (params: QueryParams) => Promise<PageResult<Row>>
  /** 导出：返回后端生成的文件；不提供则不显示导出 */
  exporter?: (params: QueryParams) => Promise<Blob>
  exportName?: string
  pageSize?: number
  /** 查询参数加工：空字符串转 undefined 已内置 */
  toParams?: (query: Query) => QueryParams
  immediate?: boolean
  /** 取数契约键：登记表中的 key，不填则用当前路由的组件标识 */
  loaderKey?: string
}

/** 当前页面在数据登记表里的契约；取数、导出、分页条数都从这里出 */
function contractOf(loaderKey?: string): PageEntry | undefined {
  const key = loaderKey ?? String(useRoute().meta.componentKey ?? '')
  return PAGE_MAP[key]
}

export function useListPage<Row extends Record<string, any>, Query extends Record<string, unknown>>(options: ListPageOptions<Row, Query>) {
  const contract = contractOf(options.loaderKey)

  const initial = { ...options.query }
  const query = reactive({ ...options.query }) as Query
  const rows = shallowRef<Row[]>([])
  const total = ref(0)
  const page = ref(1)
  // 页面内联声明仅作覆盖手段；缺省一律取登记表
  const pageSize = ref(options.pageSize ?? contract?.pageSize ?? 10)
  const loading = ref(false)
  const exporting = ref(false)
  const selected = ref<(string | number)[]>([])
  let requestId = 0

  const fetcher = options.fetch ?? (contract?.list as ((params: QueryParams) => Promise<PageResult<Row>>) | undefined) ?? null
  const doExport = options.exporter ?? contract?.exportData ?? null
  const fileName = options.exportName ?? contract?.exportName ?? ''

  function params(): QueryParams {
    const source = options.toParams ? options.toParams(query) : (query as QueryParams)
    const result: QueryParams = {}
    Object.entries(source).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) result[key] = value as QueryParams[string]
    })
    return result
  }

  async function load() {
    if (!fetcher) return
    const current = ++requestId
    loading.value = true
    try {
      const data = await fetcher({ ...params(), pageNum: page.value, pageSize: pageSize.value })
      if (current !== requestId) return
      rows.value = data.rows
      total.value = data.total
      selected.value = []
      // 删除最后一页的最后一条后回退一页
      if (data.rows.length === 0 && page.value > 1 && data.total > 0) {
        page.value = Math.max(1, Math.ceil(data.total / pageSize.value))
        await load()
      }
    } catch (error) {
      if (current === requestId) toastError(error, '数据加载失败')
    } finally {
      if (current === requestId) loading.value = false
    }
  }

  function search() {
    page.value = 1
    return load()
  }

  function reset() {
    Object.assign(query, initial)
    return search()
  }

  function setPage(value: number) {
    if (page.value !== value) page.value = value
    return load()
  }

  function setPageSize(value: number) {
    pageSize.value = value
    page.value = 1
    return load()
  }

  async function exportData() {
    if (!doExport) return
    exporting.value = true
    try {
      const blob = await doExport(params())
      downloadBlob(blob, fileName || 'export.csv')
      pushToast('已导出当前查询结果', 'ok')
    } catch (error) {
      toastError(error, '导出失败')
    } finally {
      exporting.value = false
    }
  }

  if (options.immediate !== false) load()

  return {
    query, rows, total, page, pageSize, loading, exporting, selected,
    load, search, reset, setPage, setPageSize, exportData,
    canExport: Boolean(doExport),
  }
}

/** ListPage 组件接收的列表状态（与具体行类型解耦） */
export interface ListPageState {
  query: Record<string, any>
  rows: Ref<any[]>
  total: Ref<number>
  page: Ref<number>
  pageSize: Ref<number>
  loading: Ref<boolean>
  exporting: Ref<boolean>
  selected: Ref<(string | number)[]>
  load: () => Promise<void>
  search: () => Promise<void>
  reset: () => Promise<void>
  setPage: (value: number) => Promise<void>
  setPageSize: (value: number) => Promise<void>
  exportData: () => Promise<void>
  canExport: boolean
}

/* ── 树形列表（菜单、部门）：不分页，其余能力与 useListPage 一致 ── */
export interface TreeListOptions<Row, Query extends Record<string, unknown>> {
  query: Query
  /** 留空则取登记表中的 treeList */
  fetch?: (params: QueryParams) => Promise<Row[]>
  exporter?: (params: QueryParams) => Promise<Blob>
  exportName?: string
}

export function useTreeListPage<Row extends Record<string, any>, Query extends Record<string, unknown>>(options: TreeListOptions<Row, Query>): ListPageState & { tree: true } {
  const contract = contractOf()
  const treeLoader = options.fetch ?? (contract?.treeList as ((params: QueryParams) => Promise<Row[]>) | undefined) ?? null

  const state = useListPage<Row, Query>({
    query: options.query,
    pageSize: Number.MAX_SAFE_INTEGER,
    exporter: options.exporter ?? contract?.exportData,
    exportName: options.exportName ?? contract?.exportName,
    fetch: async params => {
      const nodes = treeLoader ? await treeLoader(params) : []
      return { rows: nodes, total: nodes.length, pageNum: 1, pageSize: nodes.length }
    },
  })
  return { ...state, tree: true }
}