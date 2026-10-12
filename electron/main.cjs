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

const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain } = require('electron')
const { spawn, execSync } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const { MysqlManager } = require('./mysql-manager.cjs')
const { createLogger, logDir, openLogDir } = require('./logger.cjs')

const log = createLogger('main')
const logBoot = createLogger('boot')

const here = __dirname
const PROJECT = path.resolve(here, '..')
const SECRET_FILE = path.join(os.homedir(), 'dev-tools/scaffold-jwt-secret.txt')

const OUTER_PORT = Number(process.env.OUTER_PORT || 18080)
const INNER_PORT = Number(process.env.INNER_PORT || 18081)

let javaProc = null
let mysqlMgr = null
let redisProc = null
let gatewayServer = null
let tray = null
let win = null
let loadingWin = null
let outerPort = OUTER_PORT
let innerPort = INNER_PORT

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 更新启动进度页；窗口还没就绪时静默丢弃（不阻塞启动） */
function setStep(step, text) {
  if (!loadingWin || loadingWin.isDestroyed()) return
  loadingWin.webContents.executeJavaScript(`window.__setStep(${step}, ${JSON.stringify(text || '')})`)
    .catch(() => { /* 页面还没加载完，忽略 */ })
}
function finishStep() {
  if (!loadingWin || loadingWin.isDestroyed()) return
  loadingWin.webContents.executeJavaScript('window.__finish()').catch(() => {})
}
function failStep(why, what) {
  log.error('启动失败', { why, what })
  if (!loadingWin || loadingWin.isDestroyed()) return
  loadingWin.webContents.executeJavaScript(`window.__fail(${JSON.stringify(why)}, ${JSON.stringify(what)})`).catch(() => {})
}

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
  } catch (e) { log.warn('容器检查失败', { message: e.message }) }
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

// 启动页上的"打开日志目录"按钮
ipcMain.on('open-log-dir', () => openLogDir())

// 单实例：客户双击两次只会聚焦已有窗口，不会起第二个进程抢端口
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus() }
    else if (loadingWin && !loadingWin.isDestroyed()) loadingWin.focus()
  })
}

app.whenReady().then(async () => {
  // 先出窗口：客户立刻看到"正在启动"，而不是黑屏等一分多钟
  loadingWin = new BrowserWindow({
    width: 560, height: 520, resizable: false, maximizable: false,
    minimizable: false, fullscreenable: false,
    title: '酷炫后台管理', backgroundColor: '#0f1418',     autoHideMenuBar: true,
    preload: path.join(here, 'preload-loading.cjs'),
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  loadingWin.setMenu(null)
  loadingWin.loadFile(path.join(here, 'assets', 'loading.html'))
  loadingWin.webContents.on('did-finish-load', () => setStep(1, '正在检查运行环境…'))
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
    logBoot.info('端口已选定', { outerPort, innerPort })

    // 加载网关模块（ESM，用动态 import）
    const { startGateway } = await import(pathToFileURL(GW).href)

    if (!fs.existsSync(JAR)) throw new Error('找不到后端程序，安装可能不完整')
    if (!fs.existsSync(DIST)) throw new Error('找不到界面文件，安装可能不完整')
    setStep(1, '运行环境正常')

    // 数据库：优先用打进包里的 MySQL（客户机器没有 Docker）
    // 开发态若没放内置 MySQL，则回退到本机容器
    const mysqlBase = PACKAGED ? path.join(RES, 'mysql') : path.join(here, 'mysql')
    const sqlDir = PACKAGED ? path.join(RES, 'sql') : path.join(PROJECT, 'scaffold-system', 'sql')
    let dbReady = false
    if (MysqlManager.available(mysqlBase)) {
      // 注意：这里必须用英文路径。实测数据目录或 socket 路径含中文时
      // mysqld 起不来（端口不监听、socket 连不上），后端随即 500。
      const support = path.join(os.homedir(), 'Library/Application Support/CoolAdmin')
      mysqlMgr = new MysqlManager({
        baseDir: mysqlBase,
        dataDir: path.join(support, 'mysql-data'),
        socketDir: path.join(support, 'tmp'),
        port: 3308,
        sqlDir,
      })
      setStep(2, '正在初始化数据库…')
      dbReady = await mysqlMgr.start()
      if (dbReady) {
        await mysqlMgr.ensureSchema('scaffold_system')
        setStep(2, '数据库就绪')
      } else {
        log.warn('内置 MySQL 启动失败，尝试回退', {})
      }
    }
    if (!dbReady) await ensureContainers()

    // 缓存：优先用打进包里的 Redis；端口已占用（如开发态的容器）就直接用现成的
    const redisBin = PACKAGED ? path.join(RES, 'redis', 'redis-server') : path.join(here, 'redis', 'redis-server')
    if (fs.existsSync(redisBin) && !(await portBusy(6379))) {
      // --save '' 关掉落盘：这里只放登录令牌，不需要持久化
      // 日志重定向到文件：以前用 ignore，出问题完全看不到缓存层发生了什么
      const logFd = fs.openSync(path.join(logDir(), 'redis.log'), 'a')
      redisProc = spawn(redisBin, ['--port', '6379', '--save', '', '--appendonly', 'no'], {
        stdio: ['ignore', logFd, logFd],
      })
      log.info('内置缓存已启动', { port: 6379 })
    } else {
      log.info('使用已有的缓存服务', { port: 6379 })
    }
    setStep(3, '缓存服务就绪')

    const javaBin = path.join(JAVA_HOME, 'bin', 'java')
    const javaLog = fs.openSync(path.join(logDir(), 'java.log'), 'a')
    // -Xmx：限制堆上限，防止业务跑大后把客户整台机器拖垮
    javaProc = spawn(javaBin, ['-jar', JAR, `--server.port=${innerPort}`, '-Xmx768m'], {
      cwd: ADMIN_DIR,
      env: {
        ...process.env,
        JAVA_HOME,
        JWT_SECRET: ensureSecret(),
        DB_HOST: '127.0.0.1', DB_PORT: '3308', DB_NAME: 'scaffold_system',
        DB_USERNAME: 'root', DB_PASSWORD: 'scaffold123', DB_TIMEZONE: '+08:00',
        REDIS_HOST: '127.0.0.1', REDIS_PORT: '6379',
      },
      stdio: ['ignore', javaLog, javaLog],
    })
    javaProc.on('error', (e) => log.error('后端进程错误', { message: e.message }))
    javaProc.on('exit', (code) => log.warn('后端进程退出', { code }))
    setStep(4, '正在启动后台服务…')
    logBoot.info('后端已拉起', { innerPort })

    const ready = await waitBackend(innerPort)
    if (!ready) {
      log.error('后端启动超时', { innerPort })
      failStep('后台服务启动超时', '请点下方按钮打开日志，把日志文件发给我们。')
      return
    }
    setStep(4, '后台服务就绪')

    setStep(5, '正在准备访问入口…')
    gatewayServer = await startGateway({ port: outerPort, backendPort: innerPort, dist: DIST })
    logBoot.info('网关就绪', { outerPort })
    setStep(5, '一切就绪')

    finishStep()
    await sleep(300)
    if (loadingWin && !loadingWin.isDestroyed()) { loadingWin.close(); loadingWin = null }

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
      ...(ip ? [{
        label: `局域网  http://${ip}:${outerPort}`,
        click: () => shell.openExternal(`http://${ip}:${outerPort}`),
      }] : []),
      { type: 'separator' },
      { label: '重新打开窗口', click: () => openMainWindow() },
      { label: '打开日志目录', click: () => openLogDir() },
      { label: '停止服务并退出', click: () => app.quit() },
    ]))

    logBoot.info('系统已启动', { url: `http://localhost:${outerPort}` })
  } catch (e) {
    log.error('启动异常', { message: e && e.message ? e.message : String(e) })
    failStep('启动失败', (e && e.message ? e.message : String(e)) + '\n请把日志文件发给我们排查。')
  }
})

/** 重新打开主窗口（托盘菜单用，以前是空实现） */
function openMainWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680,
    title: '酷炫后台管理', backgroundColor: '#0f1418',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(`http://localhost:${outerPort}`)
  win.on('closed', () => { win = null })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  logBoot.info('正在停止服务')
  try { gatewayServer && gatewayServer.close() } catch { /* ignore */ }
  if (mysqlMgr) { try { mysqlMgr.stop() } catch { /* ignore */ } }
  if (redisProc && !redisProc.killed) { try { redisProc.kill('SIGTERM') } catch { /* ignore */ } }
  if (javaProc && !javaProc.killed) {
    javaProc.kill('SIGTERM')
    setTimeout(() => { try { javaProc && !javaProc.killed && javaProc.kill('SIGKILL') } catch { /* ignore */ } }, 3000)
  }
})
