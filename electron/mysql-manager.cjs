/**
 * 内置 MySQL 管理（让客户机器不依赖 Docker）
 *
 * 流程：
 *   1. 首次运行：mysqld --initialize-insecure 初始化数据目录
 *   2. 启动 mysqld（指定端口与 socket，禁用 X Plugin 免占 33060）
 *   3. 建库并导入 V1 建表脚本、V2 种子数据
 *   4. 退出时用 mysqladmin shutdown 干净停止
 *
 * 若本机没有内置 MySQL（开发态），由调用方回退到 Docker 容器。
 */

const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const { createLogger } = require('./logger.cjs')
const log = createLogger('mysql')

class MysqlManager {
  /**
   * @param {object} o
   * @param {string} o.baseDir  MySQL 解压根目录（含 bin/ 与 share/）
   * @param {string} o.dataDir  数据目录（首次会自动初始化）
   * @param {string} o.socketDir socket 与 pid 文件目录
   * @param {number} o.port
   * @param {string} [o.sqlDir]  初始化脚本目录（V1/V2）
   */
  constructor({ baseDir, dataDir, socketDir, port = 3308, sqlDir, password = 'scaffold123' }) {
    this.baseDir = baseDir
    this.dataDir = dataDir
    this.socketDir = socketDir
    this.port = port
    this.sqlDir = sqlDir
    this.password = password
    this.socket = path.join(socketDir, 'mysql.sock')
    this.pidFile = path.join(socketDir, 'mysql.pid')
    this.proc = null
  }

  static available(baseDir) {
    return !!(baseDir && fs.existsSync(path.join(baseDir, 'bin', 'mysqld')))
  }

  get bin() { return path.join(this.baseDir, 'bin') }

  env() {
    return {
      ...process.env,
      // macOS 下 mysqld 需要找到自带的动态库
      DYLD_LIBRARY_PATH: path.join(this.baseDir, 'lib'),
    }
  }

  async portOpen(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
      const s = net.createConnection({ host, port })
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => resolve(false))
      s.setTimeout(1500, () => { s.destroy(); resolve(false) })
    })
  }

  /** 数据目录是否已初始化 */
  get initialized() {
    return fs.existsSync(path.join(this.dataDir, 'mysql'))
  }

  async initialize() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.mkdirSync(this.socketDir, { recursive: true })
    log.info('首次运行，初始化数据目录…')
    execFileSync(path.join(this.bin, 'mysqld'), [
      '--initialize-insecure',
      `--basedir=${this.baseDir}`,
      `--datadir=${this.dataDir}`,
    ], { env: this.env(), stdio: 'ignore' })
    log.info('数据目录已初始化')
  }

  async start() {
    if (!this.initialized) await this.initialize()

    if (await this.portOpen(this.port)) {
      log.info(`端口 ${this.port} 已在监听，跳过启动`)
      return true
    }

    // --mysqlx=0：关掉 X Plugin，避免占用 33060
    this.proc = spawn(path.join(this.bin, 'mysqld'), [
      `--basedir=${this.baseDir}`,
      `--datadir=${this.dataDir}`,
      `--port=${this.port}`,
      `--socket=${this.socket}`,
      `--pid-file=${this.pidFile}`,
      '--mysqlx=0',
      '--default-time-zone=+08:00',
    ], { env: this.env(), stdio: 'ignore' })

    this.proc.on('error', (e) => log.error('mysqld 进程错误', { message: e.message }))

    for (let i = 0; i < 60; i++) {
      if (await this.portOpen(this.port)) { log.info(`已启动，端口 ${this.port}`); return true }
      await sleep(1000)
    }
    log.warn('启动超时', { port: this.port })
    return false
  }

  /** 建库 + 导入初始化脚本（仅首次） */
  async ensureSchema(dbName = 'scaffold_system') {
    const marker = path.join(this.dataDir, '.scaffold-initialized')
    if (fs.existsSync(marker)) return true
    if (!this.sqlDir) { log.info('未提供 SQL 目录，跳过导入'); return false }

    const mysql = path.join(this.bin, 'mysql')
    const run = (args) => execFileSync(mysql, args, { env: this.env(), stdio: 'ignore' })
    const base = ['-u', 'root', `--socket=${this.socket}`, '--default-character-set=utf8mb4']

    try {
      run([...base, '-e', `CREATE DATABASE IF NOT EXISTS ${dbName} CHARACTER SET utf8mb4`])
      const files = ['V1__init_schema.sql', 'V2__seed_data.sql']
      for (const f of files) {
        const p = path.join(this.sqlDir, f)
        if (!fs.existsSync(p)) { log.info('缺少脚本：', f); continue }
        const sql = fs.readFileSync(p, 'utf8')
        // 注意：stdio 不能用 'ignore'——那会把 stdin 一起忽略，SQL 压根喂不进去。
        // 必须给 stdin 留 pipe，否则导入静默失败（命令返回 0 但一行都没执行）。
        execFileSync(mysql, [...base, dbName], {
          env: this.env(), input: sql, stdio: ['pipe', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024,
        })
      log.info('已导入', f)
      }
      // 最后一步：initialize-insecure 建的 root 是空密码，但后端按 scaffold123 连
      // 后端走 TCP（127.0.0.1），所以 localhost 和 % 两种都要设
      execFileSync(mysql, [...base, '-e',
        `ALTER USER 'root'@'localhost' IDENTIFIED BY '${this.password}';` +
        `CREATE USER IF NOT EXISTS 'root'@'%' IDENTIFIED BY '${this.password}';` +
        `GRANT ALL PRIVILEGES ON *.* TO 'root'@'%' WITH GRANT OPTION;` +
        `FLUSH PRIVILEGES;`],
        { env: this.env(), stdio: ['pipe', 'ignore', 'pipe'] })
      log.info('root 密码已设置')

      fs.writeFileSync(marker, new Date().toISOString())
      return true
    } catch (e) {
      log.error('导入失败', { message: e.message })
      return false
    }
  }

  async stop() {
    // 优先优雅关闭，保证数据落盘
    try {
      execFileSync(path.join(this.bin, 'mysqladmin'),
        ['-u', 'root', `--password=${this.password}`, `--socket=${this.socket}`, 'shutdown'],
        { env: this.env(), stdio: 'ignore', timeout: 20000 })
      log.info('已优雅停止')
      return
    } catch { /* 退回杀进程 */ }
    if (this.proc && !this.proc.killed) {
      this.proc.kill('SIGTERM')
      setTimeout(() => { try { this.proc && !this.proc.killed && this.proc.kill('SIGKILL') } catch { /* */ } }, 5000)
    }
  }
}

module.exports = { MysqlManager }
