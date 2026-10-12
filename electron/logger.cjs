/**
 * 日志模块（生产级最低要求：出问题时能查到线索）
 *
 * 设计原则（单机部署，不引入 ELK/Sentry 之类过度设计）：
 *   1. 分级：DEBUG / INFO / WARN / ERROR，默认 INFO
 *   2. 落盘：按天分文件，保留 30 天，防止撑满客户磁盘
 *   3. 同时打到控制台：开发时 npm start 能直接看到
 *   4. 格式统一：时间 | 级别 | 模块 | 消息 —— 客户导出发你时你能直接读
 *
 * 用法：
 *   const log = createLogger('mysql')
 *   log.info('已启动', { port: 3308 })
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
const KEEP_DAYS = 30

/** 日志根目录：客户能在 Finder 里直接找到 */
function logDir() {
  const dir = path.join(os.homedir(), 'Library', 'Logs', 'CoolAdmin')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

let currentLevel = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info
let currentFile = null
let currentDay = ''

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function timestamp() {
  const d = new Date()
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 跨天自动换文件；顺便清理超过 KEEP_DAYS 的旧日志 */
function rotateIfNeeded() {
  const day = today()
  if (day === currentDay && currentFile) return
  currentDay = day
  currentFile = path.join(logDir(), `app-${day}.log`)
  try { cleanupOld() } catch { /* 清理失败不影响写日志 */ }
}

function cleanupOld() {
  const dir = logDir()
  const cutoff = Date.now() - KEEP_DAYS * 86400000
  for (const f of fs.readdirSync(dir)) {
    if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue
    const p = path.join(dir, f)
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p)
    } catch { /* 忽略单个文件失败 */ }
  }
}

function write(level, module, message, extra) {
  if (LEVELS[level] < currentLevel) return
  rotateIfNeeded()
  const line = `${timestamp()} | ${level.toUpperCase().padEnd(5)} | ${module} | ${message}` +
    (extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`)
  try { fs.appendFileSync(currentFile, line + '\n') } catch { /* 磁盘满等场景不让日志把应用搞崩 */ }
  // 开发态同时输出到控制台
  console.log(line)
}

function setLevel(level) {
  const l = LEVELS[String(level).toLowerCase()]
  if (l) currentLevel = l
}

function createLogger(module) {
  return {
    debug: (m, e) => write('debug', module, m, e),
    info: (m, e) => write('info', module, m, e),
    warn: (m, e) => write('warn', module, m, e),
    error: (m, e) => write('error', module, m, e),
  }
}

/** 打开日志目录（托盘菜单用） */
function openLogDir() {
  const { shell } = require('electron')
  shell.openPath(logDir())
}

module.exports = { createLogger, setLevel, logDir, openLogDir }
