/**
 * 酷炫后台管理 — 桌面版主进程
 *
 * 用 CommonJS 而非 ESM：Electron 打包环境下 ESM 主进程的 top-level await
 * 不生效（实测打包后无任何日志、进程静默退出），CJS 更稳。
 *
 * 职责：
 *   1. 拉起 Java 后端（内部端口）
 *   2. 自己承载网关（对外端口）—— 复用 gateway/server.mjs，不额外起进程
 *   3. 开桌面窗口，菜单栏托盘显示访问地址
 *   4. 退出时干净停掉子进程
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog } = require('electron')
const { spawn, execSync } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const here = __dirname
const PROJECT = path.resolve(here, '..')
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

function ensureSecret() {
  if (!fs.existsSync(SECRET_FILE)) {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    fs.writeFileSync(SECRET_FILE, execSync('openssl rand -hex 32').toString().trim(), { mode: 0o600 })
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim()
}

async function ensureContainers() {
  try {
    for (const c of ['scaffold-mysql', 'scaffold-redis']) {
      const exists = execSync(`docker ps -aq -f name=^${c}$`).toString().trim()
      if (!exists) continue
      const running = execSync(`docker ps -q -f name=^${c}$`).toString().trim()
      if (!running) execSync(`docker start ${c}`)
    }
    for (let i = 0; i < 30; i++) {
      try {
        execSync('docker exec scaffold-mysql mysqladmin ping -h 127.0.0.1 -uroot -pscaffold123 --silent')
        return true
      } catch { await sleep(2000) }
    }
  } catch (e) { log('容器检查失败：', e.message) }
  return false
}

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

function lanIp() {
  try {
    for (const i of ['en0', 'en1']) {
      const ip = execSync(`ipconfig getifaddr ${i} 2>/dev/null || true`).toString().trim()
      if (ip) return ip
    }
  } catch { /* ignore */ }
  return ''
}

app.whenReady().then(async () => {
  try {
    const PACKAGED = app.isPackaged
    const RES = PACKAGED ? process.resourcesPath : PROJECT

    const JAR = PACKAGED
      ? path.join(RES, 'backend', 'app.jar')
      : path.join(PROJECT, 'scaffold-system', 'scaffold-admin', 'target', 'scaffold-admin-0.1.0-SNAPSHOT.jar')
    const DIST = PACKAGED
      ? path.join(RES, 'frontend')
      : path.join(PROJECT, 'scaffold-vue', 'dist')
    const ADMIN_DIR = PACKAGED ? path.join(RES, 'backend') : path.join(PROJECT, 'scaffold-system', 'scaffold-admin')
    const JAVA_HOME = PACKAGED
      ? path.join(RES, 'runtime')
      : (process.env.SCAFFOLD_JAVA_HOME || path.join(os.homedir(), 'dev-tools/jdk-17.0.20.1+1/Contents/Home'))
    const GW = PACKAGED ? path.join(RES, 'gateway', 'server.mjs') : path.join(PROJECT, 'gateway', 'server.mjs')

    outerPort = await pickPort(OUTER_PORT)
    innerPort = await pickPort(INNER_PORT)

    // 加载网关模块（ESM，用动态 import）
    const { startGateway } = await import(pathToFileURL(GW).href)

    if (!fs.existsSync(JAR)) throw new Error(`找不到后端 jar：${JAR}`)
    if (!fs.existsSync(DIST)) throw new Error(`找不到前端产物：${DIST}`)

    await ensureContainers()

    const javaBin = path.join(JAVA_HOME, 'bin', 'java')
    javaProc = spawn(javaBin, ['-jar', JAR, `--server.port=${innerPort}`], {
      cwd: ADMIN_DIR,
      env: {
        ...process.env,
        JAVA_HOME,
        JWT_SECRET: ensureSecret(),
        DB_HOST: '127.0.0.1', DB_PORT: '3308', DB_NAME: 'scaffold_system',
        DB_USERNAME: 'root', DB_PASSWORD: 'scaffold123', DB_TIMEZONE: '+08:00',
        REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379',
      },
      stdio: 'ignore',
    })
    javaProc.on('error', (e) => log('后端进程错误：', e.message))
    log(`后端已拉起（内部 :${innerPort}）`)

    const ready = await waitBackend(innerPort)
    if (!ready) log('⚠ 后端启动超时，继续启动窗口以便查看')

    gatewayServer = await startGateway({ port: outerPort, backendPort: innerPort, dist: DIST })
    log(`网关就绪（对外 :${outerPort}）`)

    win = new BrowserWindow({
      width: 1440, height: 900, minWidth: 1024, minHeight: 680,
      title: '酷炫后台管理',
      backgroundColor: '#0f1418',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    win.loadURL(`http://localhost:${outerPort}`)
    win.on('closed', () => { win = null })

    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR42mNkYPhfz0BFwDgaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjATAaAKMBMBoAowEwGgCjAQDhGgCjATAaAKMBAAAAAAElFTkSuQmCC'
    )
    tray = new Tray(icon)
    tray.setToolTip('酷炫后台管理')
    tray.setTitle(String(outerPort))
    const ip = lanIp()
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `本机    http://localhost:${outerPort}`, click: () => shell.openExternal(`http://localhost:${outerPort}`) },
      ...(ip ? [{ label: `局域网  http://${ip}:${outerPort}`, click: () => shell.openExternal(`http://${ip}:${outerPort}`) }] : []),
      { type: 'separator' },
      { label: '重新打开窗口', click: () => { if (!win) { /* 重建 */ } } },
      { label: '停止服务并退出', click: () => app.quit() },
    ]))

    log(`已启动，对外地址 http://localhost:${outerPort}`)
  } catch (e) {
    log('启动失败：', e)
    try { dialog.showErrorBox('启动失败', String(e && e.message ? e.message : e)) } catch { /* ignore */ }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  log('正在停止服务…')
  try { gatewayServer && gatewayServer.close() } catch { /* ignore */ }
  if (javaProc && !javaProc.killed) {
    javaProc.kill('SIGTERM')
    setTimeout(() => { try { javaProc && !javaProc.killed && javaProc.kill('SIGKILL') } catch { /* ignore */ } }, 3000)
  }
})
