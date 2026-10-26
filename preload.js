'use strict'
const { contextBridge, ipcRenderer } = require('electron')

// 受控地把主进程能力暴露给渲染进程(contextIsolation 下渲染进程拿不到 Node)。
contextBridge.exposeInMainWorld('api', {
  // 取配置(含 symbols / opacity / hotkeys ...)
  getConfig: () => ipcRenderer.invoke('config:get'),
  // 持久化部分字段(如 opacity / symbols)
  patchConfig: (partial) => ipcRenderer.send('config:patch', partial),
  saveOpacity: (o) => ipcRenderer.send('config:patch', { opacity: o }),
  // A股代码/名称搜索(主进程代查:smartbox 无 CORS 头,渲染进程 fetch 会被拦)
  cnSearch: (q) => ipcRenderer.invoke('cn:search', q),
  // 面板高度随内容变化,同步窗口高度(窗口 transparent 固定宽,高度需动态)
  resizeWin: (height) => ipcRenderer.send('win:resize', { height }),
  // 渲染进程动态切换鼠标穿透(用于 header 热区 hover 时变成可点)
  setIgnore: (ignore, forward) => ipcRenderer.send('set-ignore', { ignore, forward }),
  // 手写拖拽:取窗口当前坐标 / 移动窗口
  getWinPosition: () => ipcRenderer.invoke('win:get-position'),
  moveWin: (x, y) => ipcRenderer.send('win:move', { x, y }),

  // 主 → 渲染 事件
  onInteract: (cb) => ipcRenderer.on('interact:toggle', (_e, on) => cb(on)),
  onVisibility: (cb) => ipcRenderer.on('visibility', (_e, visible) => cb(visible)),
  onGhost: (cb) => ipcRenderer.on('ghost:toggle', () => cb()),
})
