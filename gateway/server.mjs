/**
 * 对外统一入口（网关）
 *
 * 架构：内部双进程双端口，对外统一单端口。
 *
 *   外部用户  →  http://host:18080  ← 本网关（Node，无第三方依赖）
 *                    ├─ 静态页面  →  scaffold-vue/dist
 *                    └─ /api/*    →  代理到后端 127.0.0.1:18081（Java）
 *
 * 好处：
 *   1. 对外只有一个地址、一个端口，用户感知不到内部有两个服务
 *   2. 前后端保持分离：更新页面只需替换 dist，不必重启 Java 业务服务
 *   3. 静态资源与接口同源，不存在跨域
 *
 * 用法：
 *   PORT=18080 BACKEND_PORT=18081 DIST=路径 node gateway/server.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.GATEWAY_PORT || process.env.PORT || 18080)
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 18081)
const DIST = path.resolve(process.env.DIST || path.join(here, '..', 'scaffold-vue', 'dist'))

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

function log(...a) { console.log('[网关]', ...a) }

/** 转发到后端 Java 服务 */
function proxyToBackend(req, res) {
  const headers = { ...req.headers }
  delete headers['host'] // 交给 http.request 按目标重新设置

  const upstream = http.request(
    { host: '127.0.0.1', port: BACKEND_PORT, path: req.url, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )

  upstream.on('error', (err) => {
    log('后端连接失败：', err.code || err.message)
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    }
    res.end(JSON.stringify({ code: 502, message: '后端服务未就绪，请稍候再试' }))
  })

  req.pipe(upstream)
}

/** 静态文件服务；找不到则回退 index.html（前端 history 路由） */
async function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST, urlPath)

  // 防目录穿越
  if (!file.startsWith(DIST)) {
    res.writeHead(403); res.end('Forbidden'); return
  }

  try {
    const st = await fsp.stat(file)
    if (st.isDirectory()) file = path.join(DIST, 'index.html')
  } catch {
    // 文件不存在：带扩展名的按 404；否则回退到 index.html 交给前端路由
    if (path.extname(urlPath)) {
      res.writeHead(404); res.end('Not Found'); return
    }
    file = path.join(DIST, 'index.html')
  }

  try {
    const body = await fsp.readFile(file)
    const ext = path.extname(file).toLowerCase()
    const isHashed = /\/assets\//.test(urlPath) // 构建产物带内容哈希，可长缓存
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('Not Found')
  }
}

const server = http.createServer((req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api/') || url === '/api') {
    proxyToBackend(req, res)
  } else {
    serveStatic(req, res).catch(() => { res.writeHead(500); res.end('Internal Error') })
  }
})

server.listen(PORT, '0.0.0.0', () => {
  log(`对外入口   http://localhost:${PORT}`)
  log(`静态目录   ${DIST}`)
  log(`后端转发   127.0.0.1:${BACKEND_PORT}`)
  if (!fs.existsSync(DIST)) log(`⚠ 静态目录不存在，请先执行 npm run build`)
})
