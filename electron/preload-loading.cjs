/**
 * 启动进度页的预加载脚本
 * 只暴露一个"打开日志目录"的能力，不给页面其他 Node 权限
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('__openLog', () => {
  ipcRenderer.send('open-log-dir')
})
