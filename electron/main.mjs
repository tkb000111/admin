/**
 * 酷炫后台管理 — 桌面版主进程
 *
 * 职责（一个进程干三件事）：
 *   1. 拉起 Java 后端（内部端口）
 *   2. 自己承载网关（对外端口，页面 + /api 转发）—— 复用 gateway/server.mjs，不额外起进程
 *   3. 开一个桌面窗口，菜单栏托盘显示访问地址
 *
 * 退出时把子进程全部干净停掉，避免残留导致下次起不来。
 */

import { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } from 'electron'
import { spawn, execSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startGateway } from '../gateway/server.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const PROJECT = path.resolve(here, '..')
const ADMIN_DIR = path.join(PROJECT, 'scaffold-system', 'scaffold-admin')
const JAR = path.join(ADMIN_DIR, 'target', 'scaffold-admin-0.1.0-SNAPSHOT.jar')
const DIST = path.join(PROJECT, 'scaffold-vue', 'dist')
const JAVA_HOME = process.env.SCAFFOLD_JAVA_HOME || path.join(os.homedir(), 'dev-tools/jdk-17.0.20.1+1/Contents/Home')
const SECRET_FILE = path.join(os.homedir(), 'dev-tools/scaffold-jwt-secret.txt')

const OUTER_PORT = Number(process.env.OUTER_PORT || 18080)
const INNER_PORT = Number(process.env.INNER_PORT || 18081)

let javaProc = null
let gatewayServer = null
let tray = null
let win = null
let outerPort = OUTER_PORT
let innerPort = INNER_PORT

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function log(...a) { console.log('[桌面版]', ...a) }

/* ── 端口 ─────────────────────────────────────────────── */
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(true))
    s.once('listening', () => s.close(() => resolve(false)))
    s.listen(port, '127.0.0.1')
  })
}

async function pickPort(start) {
  let p = start
  while (await portBusy(p)) p++
  return p
}

/* ── 环境 ─────────────────────────────────────────────── */
function ensureSecret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    const hex = execSync('openssl rand -hex 32').toString().trim()
    fs.writeFileSync(SECRET_FILE, hex, { mode: 0o600 })
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim()
}

async function ensureContainers() {
  try {
    for (const c of ['scaffold-mysql', 'scaffold-redis']) {
      const out = execSync(`docker ps -aq -f name=^${c}$`).toString().trim()
      if (!out) continue
      const running = execSync(`docker ps -q -f name=^${c}$`).toString().trim()
      if (!running) execSync(`docker start ${c}`)
    }
    for (let i = 0; i < 30; i++) {
      try {
        execSync('docker exec scaffold-mysql mysqladmin ping -h 127.0.0.1 -uroot -pscaffold123 --silent')
        return true
      } catch { await sleep(2000) }
    }
  } catch (e) {
    log('容器检查失败（继续尝试启动后端）：', e.message)
  }
  return false
}

/* ── 后端 ─────────────────────────────────────────────── */
async function waitBackend(port, timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
        res.resume(); resolve(res.statusCode === 200)
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => { req.destroy(); resolve(false) })
    })
    if (ok) return true
    await sleep(1500)
  }
  return false
}

async function startBackend() {
  if (!fs.existsSync(JAR)) throw new Error(`找不到后端 jar：${JAR}\n请先执行 mvn package`)

  const javaBin = path.join(JAVA_HOME, 'bin', 'java')
  const env = {
    ...process.env,
    JAVA_HOME,
    JWT_SECRET: ensureSecret(),
    DB_HOST: '127.0.0.1', DB_PORT: '3308', DB_NAME: 'scaffold_system',
    DB_USERNAME: 'root', DB_PASSWORD: 'scaffold123', DB_TIMEZONE: '+08:00',
    REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379',
  }

  javaProc = spawn(javaBin, ['-jar', JAR, `--server.port=${innerPort}`], {
    cwd: ADMIN_DIR, env, stdio: 'ignore', detached: false,
  })
  javaProc.on('error', (e) => log('后端进程错误：', e.message))
  log(`后端已拉起（内部 :${innerPort}）`)
}

/* ── 地址 ─────────────────────────────────────────────── */
function lanIp() {
  try {
    for (const iface of ['en0', 'en1']) {
      const ip = execSync(`ipconfig getifaddr ${iface} 2>/dev/null || true`).toString().trim()
      if (ip) return ip
    }
  } catch { /* ignore */ }
  return ''
}

/* ── 托盘 ─────────────────────────────────────────────── */
function buildTrayMenu() {
  const ip = lanIp()
  return Menu.buildFromTemplate([
    { label: `本机    http://localhost:${outerPort}`, click: () => shell.openExternal(`http://localhost:${outerPort}`) },
    ...(ip ? [{ label: `局域网  http://${ip}:${outerPort}`, click: () => shell.openExternal(`http://${ip}:${outerPort}`) }] : []),
    { type: 'separator' },
    { label: '重新打开窗口', click: () => createWindow() },
    { label: '停止服务并退出', click: () => { app.quit() } },
  ])
}

function createTray() {
  // 1x1 PNG 兜底图标；macOS 托盘会同时显示 title
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR42mNkYPhfz0BFwDgaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjAQDhGgCjATAaAKMBAAAAAAElFTkSuQmCC'
  )
  tray = new Tray(icon)
  tray.setToolTip('酷炫后台管理')
  tray.setTitle(String(outerPort))
  tray.setContextMenu(buildTrayMenu())
}

/* ── 窗口 ─────────────────────────────────────────────── */
function createWindow() {
  if (win && !win.isDestroyed()) { win.focus(); return }
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680,
    title: '酷炫后台管理',
    backgroundColor: '#0f1418',
    autoHideMenuBar: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(`http://localhost:${outerPort}`)
  win.on('closed', () => { win = null })
}

/* ── 生命周期 ─────────────────────────────────────────── */
app.whenReady().then(async () => {
  try {
    outerPort = await pickPort(OUTER_PORT)
    innerPort = await pickPort(INNER_PORT)

    await ensureContainers()
    await startBackend()

    const ready = await waitBackend(innerPort)
    if (!ready) {
      dialog.showErrorBox('后端启动超时', '请检查 MySQL / Redis 容器是否正常运行。')
    }

    gatewayServer = await startGateway({ port: outerPort, backendPort: innerPort, dist: DIST })
    log(`网关就绪（对外 :${outerPort}）`)

    if (!fs.existsSync(DIST)) {
      dialog.showErrorBox('缺少前端产物', '请先执行：cd scaffold-vue && npm run build')
    }

    createWindow()
    createTray()
    log(`已启动，对外地址 http://localhost:${outerPort}`)
  } catch (e) {
    log('启动失败：', e)
    dialog.showErrorBox('启动失败', String(e && e.message ? e.message : e))
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // macOS 上关掉窗口不退出，保留托盘常驻（服务器模式）
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  log('正在停止服务…')
  try { gatewayServer && gatewayServer.close() } catch { /* ignore */ }
  if (javaProc && !javaProc.killed) {
    // 先优雅，再强杀
    javaProc.kill('SIGTERM')
    setTimeout(() => { try { javaProc && !javaProc.killed && javaProc.kill('SIGKILL') } catch { /* ignore */ } }, 3000)
  }
})
