/* ============================================================
   图谱舞台的 Canvas 绘制件（珍珠玻璃语汇）：珍珠球、玻璃刻度表盘、实色细线与脉冲、
   开场涟漪、真实数据背景网络、刻度轨道、台阶光柱。
   规则与浅色图谱一致：实色细线 + 同色淡光环 + 软阴影，不用叠加发光；颜色取 --graph-* 三元组，
   浅 / 深主题各一套。纯绘制函数，不持有状态；帧循环、弹簧与命中区由 RelationGraph 负责。
   ============================================================ */

export type RGB = string // "r, g, b"，直接拼进 rgba()

export interface StagePalette {
  cat: RGB[] // 下标 1–5 对应 --graph-1~5，0 为中性墨色
  ink: RGB
  accent: RGB
  lime: RGB
  danger: RGB
  paper: RGB
}

export function readStagePalette(el: Element): StagePalette {
  const css = getComputedStyle(el)
  const get = (name: string, fallback: RGB) => css.getPropertyValue(name).trim() || fallback
  const ink = get('--graph-ink', '46, 58, 62')
  return {
    cat: [ink, get('--graph-1', '186, 140, 52'), get('--graph-2', '58, 122, 206'), get('--graph-3', '122, 96, 204'), get('--graph-4', '200, 90, 118'), get('--graph-5', '58, 150, 92')],
    ink,
    accent: get('--graph-accent', '35, 109, 233'),
    lime: get('--graph-lime', '110, 190, 36'),
    danger: get('--graph-danger', '224, 68, 59'),
    paper: get('--graph-paper', '255, 255, 255'),
  }
}

const TAU = Math.PI * 2
const rgba = (c: RGB, a: number) => `rgba(${c}, ${Math.max(0, Math.min(1, a))})`

/** 稳定伪随机：同一 seed 每帧一致 */
export const seedOf = (id: string) => {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 1000) / 1000
}

/** 刻度环：n 根径向短刻度，前 lit 比例着色 */
function tickRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, len: number, n: number, base: string, litColor: string, lit: number, width = 1.2) {
  ctx.lineCap = 'round'
  ctx.lineWidth = width
  const litCount = Math.round(n * Math.max(0, Math.min(1, lit)))
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i / n) * TAU
    ctx.strokeStyle = i < litCount ? litColor : base
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    ctx.lineTo(x + Math.cos(a) * (r + len), y + Math.sin(a) * (r + len))
    ctx.stroke()
  }
}

/* ── 珍珠球：软阴影 + 珠光渐变 + 青柠 / 蓝的淡虹彩 + 缓慢扫描的刻度环 ── */
export function paintOrb(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, p: StagePalette, opts: { alpha?: number; live?: boolean } = {}) {
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01 || r <= 1) return
  const live = opts.live ?? true
  ctx.save()
  ctx.globalAlpha = alpha
  // 外圈刻度：常态浅墨，一段蓝色扫描弧缓慢转动（导 Conduct）
  const ringR = r * 1.3
  const n = 72
  const head = live ? (t * 0.35) % TAU : 0.9
  ctx.lineCap = 'round'
  ctx.lineWidth = 1.2
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * TAU
    const behind = ((head - a) % TAU + TAU) % TAU
    const k = behind < 1.1 ? 1 - behind / 1.1 : 0
    const major = i % 6 === 0
    ctx.strokeStyle = k > 0 ? rgba(p.accent, 0.2 + k * 0.65) : rgba(p.ink, major ? 0.22 : 0.12)
    const len = major ? 6 : 3.5
    ctx.beginPath()
    ctx.moveTo(x + Math.cos(a) * ringR, y + Math.sin(a) * ringR)
    ctx.lineTo(x + Math.cos(a) * (ringR + len), y + Math.sin(a) * (ringR + len))
    ctx.stroke()
  }
  // 绕环一枚青柠卫星
  const sa = live ? -t * 0.22 : -0.6
  const sx = x + Math.cos(sa) * (ringR + 15), sy = y + Math.sin(sa) * (ringR + 15)
  ctx.fillStyle = rgba(p.lime, 0.2)
  ctx.beginPath(); ctx.arc(sx, sy, 7, 0, TAU); ctx.fill()
  ctx.fillStyle = rgba(p.lime, 1)
  ctx.beginPath(); ctx.arc(sx, sy, 3, 0, TAU); ctx.fill()
  // 球体：软阴影 + 珠光
  ctx.shadowColor = rgba(p.ink, 0.2)
  ctx.shadowBlur = r * 0.6
  ctx.shadowOffsetY = r * 0.2
  const body = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r)
  body.addColorStop(0, 'rgba(255, 255, 255, 1)')
  body.addColorStop(0.55, 'rgba(246, 249, 248, 1)')
  body.addColorStop(1, 'rgba(214, 223, 221, 1)')
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  ctx.shadowColor = 'transparent'
  // 淡虹彩：右下青柠、左下蓝，缓慢游移
  const drift = live ? Math.sin(t * 0.5) * 0.12 : 0
  const sheen = (cx: number, cy: number, c: RGB, a: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9)
    g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  }
  sheen(x + r * (0.45 + drift), y + r * 0.5, p.lime, 0.22)
  sheen(x - r * (0.5 - drift), y + r * 0.45, p.accent, 0.14)
  // 边缘与高光
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(p.ink, 0.1)
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke()
  ctx.strokeStyle = 'rgba(255, 255, 255, .95)'
  ctx.lineWidth = 1.6
  ctx.beginPath(); ctx.arc(x, y, r * 0.84, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke()
  ctx.restore()
}

/* ── 玻璃刻度表盘：玻璃圆盘 + 内圈刻度（ratio 比例着分类色），激活时外圈淡光环 ── */
export function paintDial(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, t: number, c: RGB, p: StagePalette, opts: { alpha?: number; ratio?: number; active?: boolean; live?: boolean } = {}) {
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01 || s <= 4) return
  const R = s / 2
  const ratio = Math.max(0, Math.min(1, opts.ratio ?? 0))
  ctx.save()
  ctx.globalAlpha = alpha
  if (opts.active) {
    const halo = ctx.createRadialGradient(x, y, R, x, y, R + 20)
    halo.addColorStop(0, rgba(c, 0.18)); halo.addColorStop(1, rgba(c, 0))
    ctx.fillStyle = halo
    ctx.beginPath(); ctx.arc(x, y, R + 20, 0, TAU); ctx.fill()
  }
  ctx.shadowColor = rgba(p.ink, 0.13)
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 9
  const body = ctx.createLinearGradient(x, y - R, x, y + R)
  body.addColorStop(0, rgba(p.paper, 1))
  body.addColorStop(1, rgba(p.paper, 0.92))
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill()
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 1
  ctx.strokeStyle = opts.active ? rgba(c, 0.55) : rgba(p.ink, 0.09)
  ctx.beginPath(); ctx.arc(x, y, R - 0.5, 0, TAU); ctx.stroke()
  // 顶部白色内高光
  ctx.strokeStyle = 'rgba(255, 255, 255, .9)'
  ctx.beginPath(); ctx.arc(x, y, R - 2, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke()
  // 内圈刻度：比例弧着色；激活时沿着色段走一枚亮刻度
  const n = s > 90 ? 60 : 40
  tickRing(ctx, x, y, R * 0.76, Math.max(4, R * 0.11), n, rgba(p.ink, 0.12), rgba(c, 0.92), ratio, s > 90 ? 1.5 : 1.2)
  if (opts.active && opts.live !== false && ratio > 0) {
    const a = -Math.PI / 2 + ((t * 0.5) % 1) * TAU * ratio
    ctx.fillStyle = rgba(c, 1)
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * R * 0.94, y + Math.sin(a) * R * 0.94, 2.2, 0, TAU); ctx.fill()
  }
  ctx.restore()
}

/* ── 连线：同色实线，激活时加极淡宽晕 ── */
export interface Curve { x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
export function paintThread(ctx: CanvasRenderingContext2D, g: Curve, c: RGB, alpha: number, width = 1, dashed = false) {
  if (alpha <= 0.01) return
  ctx.save()
  ctx.lineCap = 'round'
  if (dashed) ctx.setLineDash([3, 5])
  const path = new Path2D()
  path.moveTo(g.x1, g.y1)
  path.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.x2, g.y2)
  if (width > 1.2) {
    ctx.strokeStyle = rgba(c, alpha * 0.1)
    ctx.lineWidth = width * 4
    ctx.stroke(path)
  }
  ctx.strokeStyle = rgba(c, alpha)
  ctx.lineWidth = width
  ctx.stroke(path)
  ctx.restore()
}

/* ── 脉冲：实心点 + 纸色芯 + 同色 18% 光环 ── */
export function paintPulse(ctx: CanvasRenderingContext2D, x: number, y: number, c: RGB, alpha: number, r = 3, paper: RGB = '255, 255, 255') {
  if (alpha <= 0.02) return
  ctx.save()
  ctx.fillStyle = rgba(c, alpha * 0.18)
  ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.fill()
  ctx.fillStyle = rgba(c, alpha)
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  ctx.fillStyle = rgba(paper, alpha * 0.9)
  ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, TAU); ctx.fill()
  ctx.restore()
}

/* ── 节点圆点：分类色实心 + 纸色描边，悬停加同色光环 ── */
export function paintDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, c: RGB, alpha: number, p: StagePalette, ring = false) {
  if (alpha <= 0.01) return
  ctx.save()
  if (ring) {
    ctx.fillStyle = rgba(c, alpha * 0.16)
    ctx.beginPath(); ctx.arc(x, y, r + 6, 0, TAU); ctx.fill()
  }
  ctx.fillStyle = rgba(c, alpha)
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
  ctx.strokeStyle = rgba(p.paper, alpha * 0.95)
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()
}

/* ── 开场涟漪：三道细环从中心荡开后消失（k 为 0→1 进度） ── */
export function paintRipple(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, R: number, p: StagePalette) {
  if (k <= 0 || k >= 1) return
  ctx.save()
  for (let i = 0; i < 3; i += 1) {
    const kk = Math.max(0, Math.min(1, (k - i * 0.14) / 0.72))
    if (kk <= 0 || kk >= 1) continue
    const e = 1 - Math.pow(1 - kk, 3)
    ctx.strokeStyle = rgba(i === 1 ? p.lime : p.accent, (1 - kk) * 0.45)
    ctx.lineWidth = 1.4
    ctx.beginPath(); ctx.arc(x, y, 30 + e * R, 0, TAU); ctx.stroke()
  }
  ctx.restore()
}

/* ── 背景网络：真实数据点位，按层级从中心逐层蔓延；聚焦某类时其余降亮 ── */
export interface NetNode { id: string; x: number; y: number; cat: number; r?: number; depth?: number; label?: string; tone?: 'danger' | 'off'; /** 放射方向（弧度）：有值时标签沿该方向向外排，左半边翻转保持可读 */ angle?: number }
export interface NetLink { a: string; b: string; cat?: number; both?: boolean; /** 跨类关系：只在聚焦某类时出现 */ cross?: boolean }
export interface NetworkData { nodes: NetNode[]; links: NetLink[] }

export function paintNetwork(ctx: CanvasRenderingContext2D, net: NetworkData, opts: {
  t: number
  since: number
  live: boolean
  palette: StagePalette
  /** 只高亮该类（cat）；null 为全部正常 */
  focusCat?: number | null
  /** 整体透明度（下钻时退远） */
  alpha?: number
  labels?: boolean
}) {
  const { t, since, live, palette: p } = opts
  const alpha = opts.alpha ?? 1
  if (alpha <= 0.01 || !net.nodes.length) return
  const pos = new Map<string, { x: number; y: number; g: number; n: NetNode }>()
  net.nodes.forEach((n) => {
    const seed = seedOf(n.id)
    const g = live ? Math.min(1, Math.max(0, (since - 0.4 - (n.depth ?? 1) * 0.3 - seed * 0.3) / 0.8)) : 1
    const e = 1 - Math.pow(1 - g, 3)
    const sway = live ? Math.sin(t * 0.5 + seed * 6.28) * 2 : 0
    pos.set(n.id, { x: n.x + sway, y: n.y + (live ? Math.cos(t * 0.4 + seed * 9) * 1.6 : 0), g: e, n })
  })
  const focused = Boolean(opts.focusCat)
  const on = (n: NetNode) => !focused || n.cat === opts.focusCat
  ctx.save()
  ctx.lineWidth = 0.8
  net.links.forEach((l, i) => {
    const A = pos.get(l.a), B = pos.get(l.b)
    if (!A || !B) return
    const g = Math.min(A.g, B.g)
    if (g <= 0.02) return
    if (l.cross && (!focused || !(on(A.n) || on(B.n)))) return
    const lit = l.cross ? true : on(A.n) && on(B.n)
    const c = p.cat[l.cat ?? A.n.cat] ?? p.ink
    const a = (l.cross ? 0.3 : l.both ? 0.24 : 0.15) * g * alpha * (lit ? (focused ? 2.2 : 1) : 0.3)
    ctx.strokeStyle = rgba(c, a)
    ctx.beginPath()
    // 线随生长从起点伸出
    const bx = A.x + (B.x - A.x) * g, by = A.y + (B.y - A.y) * g
    if (l.both) {
      const mx = (A.x + bx) / 2 + (by - A.y) * 0.12, my = (A.y + by) / 2 - (bx - A.x) * 0.12
      ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(mx, my, bx, by)
    } else {
      ctx.moveTo(A.x, A.y); ctx.lineTo(bx, by)
    }
    ctx.stroke()
    if (live && lit && focused && i < 60 && g > 0.95) {
      const u = (t * 0.18 + seedOf(l.a + l.b)) % 1
      paintPulse(ctx, A.x + (B.x - A.x) * u, A.y + (B.y - A.y) * u, c, Math.sin(u * Math.PI) * alpha * 0.9, 2.2, p.paper)
    }
  })
  ctx.restore()
  // 聚焦类条目过多时不画名称（进入模块层看带标签的胶囊），避免文字互相压叠
  const labelOk = opts.labels && net.nodes.filter(n => on(n) && n.label).length <= 18
  pos.forEach(({ x, y, g, n }) => {
    if (g <= 0) return
    const lit = on(n)
    const c = n.tone === 'danger' ? p.danger : p.cat[n.cat] ?? p.ink
    const r = (n.r ?? 2.4) * (focused && lit ? 1.25 : 1)
    paintDot(ctx, x, y, r, c, g * alpha * (lit ? 0.9 : 0.3) * (n.tone === 'off' ? 0.5 : 1), p)
    if (labelOk && n.label && g > 0.9 && lit && focused && alpha > 0.6) {
      ctx.save()
      ctx.fillStyle = rgba(p.ink, 0.78 * alpha)
      ctx.font = '11px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.textBaseline = 'middle'
      const text = n.label.length > 9 ? `${n.label.slice(0, 8)}…` : n.label
      if (n.angle === undefined) {
        ctx.fillText(text, x + r + 6, y)
      } else {
        ctx.translate(x, y)
        const left = Math.cos(n.angle) < 0
        ctx.rotate(left ? n.angle + Math.PI : n.angle)
        ctx.textAlign = left ? 'right' : 'left'
        ctx.fillText(text, left ? -(r + 6) : r + 6, 0)
      }
      ctx.restore()
    }
  })
}

/* ── 轨道：淡墨虚线椭圆 + 缓慢转动的刻度（星图仪感） ── */
export function paintOrbit(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, t: number, p: StagePalette, alpha = 1) {
  if (alpha <= 0.01 || rx <= 0 || ry <= 0) return
  ctx.save()
  ctx.strokeStyle = rgba(p.ink, 0.09 * alpha)
  ctx.lineWidth = 1
  ctx.setLineDash([2, 5])
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.stroke()
  ctx.setLineDash([])
  const spin = t * 0.015
  for (let i = 0; i < 96; i += 1) {
    const a = spin + (i / 96) * TAU
    const major = i % 8 === 0
    const ex = Math.cos(a), ey = Math.sin(a)
    const x = cx + ex * rx, y = cy + ey * ry
    const nx = ex / rx, ny = ey / ry
    const nl = Math.hypot(nx, ny) || 1
    const len = major ? 6 : 2.5
    ctx.strokeStyle = rgba(p.ink, (major ? 0.2 : 0.1) * alpha)
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (nx / nl) * len, y + (ny / nl) * len); ctx.stroke()
  }
  ctx.restore()
}

/* ── 台阶光柱：从台面垂到地平线的分类色淡柱，选中时更实 ── */
export function paintPillar(ctx: CanvasRenderingContext2D, x: number, top: number, floor: number, width: number, c: RGB, alpha: number, active = false) {
  if (alpha <= 0.01 || floor <= top) return
  ctx.save()
  const g = ctx.createLinearGradient(0, top, 0, floor)
  g.addColorStop(0, rgba(c, (active ? 0.2 : 0.1) * alpha))
  g.addColorStop(1, rgba(c, 0.01))
  ctx.fillStyle = g
  ctx.fillRect(x - width / 2, top, width, floor - top)
  const e = ctx.createLinearGradient(0, top, 0, floor)
  e.addColorStop(0, rgba(c, (active ? 0.5 : 0.24) * alpha))
  e.addColorStop(1, rgba(c, 0))
  ctx.strokeStyle = e
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x - width / 2 + 0.5, top); ctx.lineTo(x - width / 2 + 0.5, floor)
  ctx.moveTo(x + width / 2 - 0.5, top); ctx.lineTo(x + width / 2 - 0.5, floor)
  ctx.stroke()
  ctx.restore()
}

/* ── 地平线：一条带刻度的淡墨基线 ── */
export function paintHorizon(ctx: CanvasRenderingContext2D, y: number, x0: number, x1: number, p: StagePalette) {
  ctx.save()
  ctx.strokeStyle = rgba(p.ink, 0.16)
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke()
  for (let x = x0, i = 0; x <= x1; x += 12, i += 1) {
    ctx.strokeStyle = rgba(p.ink, i % 5 === 0 ? 0.2 : 0.1)
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + (i % 5 === 0 ? 6 : 3)); ctx.stroke()
  }
  ctx.restore()
}

/* ============================================================
   架构图：横排的「层柱 + 神经元」，语汇与浅色图谱一致但构图反过来——
   主体不再是散点，而是层。层内神经元数量固定，人数只调「点亮到第几颗」，
   所以渲染图元数只随岗位数变化，与在岗人数多少无关。
   静态件（层柱 / 神经元 / 连线 / 主干）与动态件（沿主干流动的脉冲）分开，
   前者可整体预渲染到离屏画布，每帧只贴图 + 画几枚脉冲。
   ============================================================ */

export interface ArchLayer {
  /** 层柱中心 */
  x: number
  /** 层柱中线 */
  y: number
  /** 层柱半高 */
  h: number
  /** 在岗人数归一化到 0–1 的强度 */
  intensity: number
  /** 分类色下标 */
  cat: number
  /** 是否为当前选中层 */
  active: boolean
  /** 层内神经元数（固定） */
  n: number
  /** 非选中层的整体压暗系数 0–1 */
  dim: number
}

export interface ArchEdge { x1: number; y1: number; x2: number; y2: number; cat: number; w: number }

export type ArchSpine = Array<{ x: number; y: number }>

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') { ctx.roundRect(x, y, w, h, r); return }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 层柱底板：淡分类色打底 + 纸色高光 + 发丝描边。刻意不用玻璃——画布每帧重绘时模糊无法缓存 */
export function paintArchPlate(ctx: CanvasRenderingContext2D, layer: ArchLayer, p: StagePalette, width = 52) {
  const top = layer.y - layer.h
  const bot = layer.y + layer.h
  const c = p.cat[layer.cat] ?? p.ink
  ctx.save()
  ctx.globalAlpha = layer.dim
  roundRect(ctx, layer.x - width / 2, top, width, bot - top, 14)
  // 极淡分类色打底，让层柱在浅底上立得住
  ctx.fillStyle = rgba(c, layer.active ? 0.1 : 0.06)
  ctx.fill()
  const g = ctx.createLinearGradient(0, top, 0, bot)
  g.addColorStop(0, rgba(p.paper, 0.7))
  g.addColorStop(1, rgba(p.paper, 0.14))
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = rgba(c, layer.active ? 0.5 : 0.24)
  ctx.stroke()
  // 上下接口端头：读作层与层的接驳
  ctx.fillStyle = rgba(c, layer.active ? 0.72 : 0.3)
  roundRect(ctx, layer.x - width / 2, top - 2.5, width, 2.5, 1.2)
  ctx.fill()
  roundRect(ctx, layer.x - width / 2, bot, width, 2.5, 1.2)
  ctx.fill()
  ctx.restore()
}

/** 神经元柱：强度决定「点亮到第几颗」，边界处连续过渡（与刻度环同一套读法） */
export function paintArchNeurons(ctx: CanvasRenderingContext2D, layer: ArchLayer, p: StagePalette) {
  const c = p.cat[layer.cat] ?? p.ink
  const top = layer.y - layer.h
  const step = (layer.h * 2) / (layer.n + 1)
  const lit = layer.intensity * layer.n
  ctx.save()
  ctx.globalAlpha = layer.dim
  for (let i = 0; i < layer.n; i++) {
    const y = top + step * (i + 1)
    const fill = Math.max(0, Math.min(1, lit - i))
    const a = 0.1 + fill * 0.9
    const r = 4.2 + fill * 2.6
    if (layer.active) {
      ctx.fillStyle = rgba(c, 0.13)
      ctx.beginPath(); ctx.arc(layer.x, y, r + 7, 0, TAU); ctx.fill()
    }
    ctx.fillStyle = rgba(c, a)
    ctx.beginPath(); ctx.arc(layer.x, y, r, 0, TAU); ctx.fill()
    ctx.lineWidth = 1.3
    ctx.strokeStyle = rgba(p.paper, 0.96)
    ctx.stroke()
  }
  ctx.restore()
}

/** 层间连线：相邻层全连接，作极淡的肌理，不喧宾夺主 */
export function paintArchWeb(ctx: CanvasRenderingContext2D, edges: ArchEdge[], p: StagePalette) {
  ctx.save()
  ctx.lineWidth = 1
  for (const e of edges) {
    ctx.strokeStyle = rgba(p.cat[e.cat] ?? p.ink, e.w)
    ctx.beginPath()
    ctx.moveTo(e.x1, e.y1)
    ctx.lineTo(e.x2, e.y2)
    ctx.stroke()
  }
  ctx.restore()
}

/** 主干经过每个神经元，但逐层用中点二次曲线过渡——逐层跳变时读作信号起伏，而不是锯齿 */
function spineMid(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** 与 paintArchSpine 同构地取点，脉冲才会贴着线走 */
export function archSpineAt(pts: ArchSpine, u: number) {
  const n = pts.length
  if (n < 2) return pts[0] ?? { x: 0, y: 0 }
  const f = Math.max(0, Math.min(1, u)) * n
  const i = Math.min(n - 1, Math.floor(f))
  const t = f - i
  if (i === 0) {
    const b = spineMid(pts[0], pts[1])
    return { x: pts[0].x + (b.x - pts[0].x) * t, y: pts[0].y + (b.y - pts[0].y) * t }
  }
  if (i === n - 1) {
    const a = spineMid(pts[n - 2], pts[n - 1])
    return { x: a.x + (pts[n - 1].x - a.x) * t, y: a.y + (pts[n - 1].y - a.y) * t }
  }
  const p0 = spineMid(pts[i - 1], pts[i])
  const p1 = spineMid(pts[i], pts[i + 1])
  const c = pts[i]
  const it = 1 - t
  return {
    x: it * it * p0.x + 2 * it * t * c.x + t * t * p1.x,
    y: it * it * p0.y + 2 * it * t * c.y + t * t * p1.y,
  }
}

/** 主干：逐层穿过一颗神经元的信号线。走中性墨色，只作信号线不抢分类色 */
/** 主干路径（SVG path 数据）：画布描边与 CSS offset-path 共用同一条曲线，两边不会走样 */
export function archSpinePath(pts: ArchSpine): string {
  const n = pts.length
  if (n < 2) return ''
  const f = (v: number) => v.toFixed(1)
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => `${f((a.x + b.x) / 2)},${f((a.y + b.y) / 2)}`
  let d = `M${f(pts[0].x)},${f(pts[0].y)} L${mid(pts[0], pts[1])}`
  for (let i = 1; i < n - 1; i += 1) d += ` Q${f(pts[i].x)},${f(pts[i].y)} ${mid(pts[i], pts[i + 1])}`
  return `${d} L${f(pts[n - 1].x)},${f(pts[n - 1].y)}`
}

export function paintArchSpine(ctx: CanvasRenderingContext2D, pts: ArchSpine, c: RGB, p: StagePalette, alpha = 1, width = 1.3) {
  const d = archSpinePath(pts)
  if (!d) return
  const path = new Path2D(d)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = width + 4
  ctx.strokeStyle = rgba(c, 0.05 * alpha)
  ctx.stroke(path)
  ctx.lineWidth = width
  ctx.strokeStyle = rgba(c, 0.3 * alpha)
  ctx.stroke(path)
  ctx.restore()
}

/** 脉冲在主干上的取样点与速度，供 DOM 脉冲元素逐帧定位（只写 transform，不触发重绘） */
export function archFlowSpots(pts: ArchSpine, t: number, count = 3, speed = 0.15) {
  const out: Array<{ x: number; y: number; fade: number }> = []
  if (pts.length < 2) return out
  for (let k = 0; k < count; k += 1) {
    const u = (t * speed + k / count) % 1
    const at = archSpineAt(pts, u)
    out.push({ x: at.x, y: at.y, fade: Math.min(1, Math.sin(u * Math.PI) * 1.7) })
  }
  return out
}
