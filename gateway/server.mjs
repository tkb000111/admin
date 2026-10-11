/**
 * 对外统一入口（网关）
 *
 *   外部用户 → 网关 :18080（页面 + /api 转发）
 *                 └→ 后端 :18081（Java，只处理 /api）
 *
 * 两种用法：
 *   1. 独立运行：PORT=18080 BACKEND_PORT=18081 node gateway/server.mjs
 *   2. 被 Electron 主进程 import 后调用 startGateway()（此时不额外起进程）
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** 转发到后端 Java 服务 */
function proxyToBackend(req, res, backendPort) {
  const headers = { ...req.headers }
  delete headers['host']
  const upstream = http.request(
    { host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers },
    (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res) }
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ code: 502, message: '后端服务未就绪，请稍候再试' }))
  })
  req.pipe(upstream)
}

/** 静态文件服务；找不到则回退 index.html（前端 history 路由） */
async function serveStatic(req, res, dist) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(dist, urlPath)

  if (!file.startsWith(dist)) { res.writeHead(403); res.end('Forbidden'); return }

  try {
    const st = await fsp.stat(file)
    if (st.isDirectory()) file = path.join(dist, 'index.html')
  } catch {
    if (path.extname(urlPath)) { res.writeHead(404); res.end('Not Found'); return }
    file = path.join(dist, 'index.html')
  }

  try {
    const body = await fsp.readFile(file)
    const ext = path.extname(file).toLowerCase()
    const isHashed = /\/assets\//.test(urlPath)
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('Not Found')
  }
}

/**
 * 启动网关
 * @returns {Promise<import('node:http').Server>}
 */
export function startGateway({ port = 18080, backendPort = 18081, dist } = {}) {
  const DIST = dist || path.join(here, '..', 'scaffold-vue', 'dist')
  const server = http.createServer((req, res) => {
    const url = req.url || '/'
    if (url.startsWith('/api/') || url === '/api') proxyToBackend(req, res, backendPort)
    else serveStatic(req, res, DIST).catch(() => { res.writeHead(500); res.end('Internal Error') })
  })
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => resolve(server))
  })
}

/* ── 独立运行模式 ───────────────────────────────────────── */
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  const port = Number(process.env.GATEWAY_PORT || process.env.PORT || 18080)
  const backendPort = Number(process.env.BACKEND_PORT || 18081)
  const dist = process.env.DIST || path.join(here, '..', 'scaffold-vue', 'dist')
  startGateway({ port, backendPort, dist }).then(() => {
    console.log(`[网关] 对外入口   http://localhost:${port}`)
    console.log(`[网关] 静态目录   ${dist}`)
    console.log(`[网关] 后端转发   127.0.0.1:${backendPort}`)
    if (!fs.existsSync(dist)) console.log('[网关] ⚠ 静态目录不存在，请先执行 npm run build')
  })
}
