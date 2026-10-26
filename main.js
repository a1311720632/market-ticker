'use strict'
const { app, BrowserWindow, globalShortcut, Tray, Menu, screen, ipcMain, nativeImage, net } = require('electron')
const path = require('path')
const fs = require('fs')

// ---------- 配置层(纯 fs JSON,零依赖) ----------
function configPath() { return path.join(app.getPath('userData'), 'config.json') }
const defaultConfigPath = path.join(__dirname, 'config.default.json')

function loadConfig() {
  const cp = configPath()
  try {
    if (!fs.existsSync(cp)) {
      fs.mkdirSync(app.getPath('userData'), { recursive: true })
      fs.copyFileSync(defaultConfigPath, cp)
    }
    return JSON.parse(fs.readFileSync(cp, 'utf8'))
  } catch (e) {
    console.error('[config] 读取失败,回退默认:', e)
    return JSON.parse(fs.readFileSync(defaultConfigPath, 'utf8'))
  }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2)) }
  catch (e) { console.error('[config] 保存失败:', e) }
}

// ---------- 全局状态 ----------
let config = loadConfig()
let win = null
let tray = null
let interactMode = false
let hidden = false
let quitting = false
let savePosTimer = null

// 透明窗黑底兜底:必须在 app ready 前调用
if (config.disableHardwareAcceleration) {
  app.disableHardwareAcceleration()
}

// 单实例:防止多次启动叠出多个悬浮窗
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { showWindow() })
  app.whenReady().then(boot)
}

function boot() {
  createWindow()
  createTray()
  registerHotkeys()
  setInteract(false) // 默认鼠标穿透
}

// ---------- 窗口 ----------
function createWindow() {
  config = loadConfig()
  win = new BrowserWindow({
    width: 230,
    height: 190,
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  })
  // screen-saver 是 Windows 上最高的置顶层级,高于其它"始终置顶"窗口,
  // 保证行情条恒浮在最外层,不会被后续打开的软件盖住。
  win.setAlwaysOnTop(true, 'screen-saver')
  win.loadFile(path.join(__dirname, 'src', 'index.html'))

  win.once('ready-to-show', () => {
    restorePosition()
    win.show()
  })

  // 失焦兜底:某些"始终置顶"软件激活后会抢占 topmost,这里重新断言一次,
  // 把行情条推回最上层(隐藏态下跳过,避免无谓的 Z 序抖动)。
  win.on('blur', reassertTop)

  win.on('move', scheduleSavePosition)
  win.on('resize', scheduleSavePosition)
  // 关闭(Alt+F4 等)只隐藏,真正退出走托盘「退出」
  win.on('close', (e) => {
    if (!quitting) { e.preventDefault(); hideWindow() }
  })
  win.on('closed', () => { win = null })
}

function restorePosition() {
  if (!win) return
  const pos = config.position
  const [w, h] = win.getSize()
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    const display = screen.getDisplayMatching({ x: pos.x, y: pos.y, width: w, height: h })
    const db = display.bounds
    const x = Math.max(db.x, Math.min(pos.x, db.x + db.width - w))
    const y = Math.max(db.y, Math.min(pos.y, db.y + db.height - h))
    win.setPosition(Math.round(x), Math.round(y))
  } else {
    const db = screen.getPrimaryDisplay().bounds
    win.setPosition(db.x + db.width - w - 16, db.y + 16) // 默认右上角
  }
}

function scheduleSavePosition() {
  if (!win) return
  clearTimeout(savePosTimer)
  savePosTimer = setTimeout(() => {
    if (!win) return
    const [x, y] = win.getPosition()
    config.position = { x, y }
    saveConfig(config)
  }, 500)
}

// 重新断言置顶:先撤再立,确保在 topmost 区段内被重新排到最上。
function reassertTop() {
  if (!win || win.isDestroyed() || hidden) return
  win.setAlwaysOnTop(false)
  win.setAlwaysOnTop(true, 'screen-saver')
}

// ---------- 托盘 ----------
function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
  if (img.isEmpty()) {
    console.warn('[tray] icon.png 缺失或为空,跳过托盘(快捷键仍可用)。运行 npm run make-icon 生成。')
    return
  }
  tray = new Tray(img)
  tray.setToolTip('打工人行情条  Ctrl+` 交互 / Ctrl+Shift+H 隐藏')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: toggleHide },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]))
  tray.on('click', toggleHide)
}

// ---------- 全局快捷键 ----------
function registerHotkeys() {
  const hk = config.hotkeys || {}
  const safe = (acc, cb, name) => {
    if (!acc) return
    try {
      const ok = globalShortcut.register(acc, cb)
      if (!ok) console.warn(`[hotkey] 注册失败(可能被占用): ${name} = ${acc}`)
      else console.log(`[hotkey] ${name} = ${acc}`)
    } catch (e) { console.warn(`[hotkey] ${name} 异常:`, e) }
  }
  safe(hk.interact, toggleInteract, '交互')
  safe(hk.boss, toggleHide, '老板键')
  safe(hk.ghost, toggleGhost, '幽灵')
}

// ---------- 模式切换 ----------
function setInteract(on) {
  interactMode = on
  if (!win) return
  if (on) win.setIgnoreMouseEvents(false)               // 可交互:能拖、能调
  else win.setIgnoreMouseEvents(true, { forward: true }) // 穿透:不挡下层
  win.webContents.send('interact:toggle', on)
}
function toggleInteract() { setInteract(!interactMode) }

function hideWindow() {
  if (!win || hidden) return
  hidden = true
  win.hide()
  win.webContents.send('visibility', false)
  console.log('[hide] 已隐藏,暂停数据')
}
function showWindow() {
  if (!win) return
  restorePosition() // 隐藏期间可能换了显示器
  win.show()
  if (!hidden) return
  hidden = false
  reassertTop()
  win.webContents.send('visibility', true)
  console.log('[hide] 已恢复,继续数据')
}
function toggleHide() { hidden ? showWindow() : hideWindow() }

function toggleGhost() {
  // 幽灵开关态由渲染进程维护,这里只发"切换一下"信号,避免主/渲染状态错位
  if (win) win.webContents.send('ghost:toggle')
}

// ---------- IPC ----------
ipcMain.handle('config:get', () => loadConfig())
ipcMain.on('config:patch', (_e, partial) => {
  config = Object.assign(config, partial || {})
  saveConfig(config)
})
// 渲染进程按热区动态开关鼠标穿透(穿透态下 header 悬停时变可点)
ipcMain.on('set-ignore', (_e, payload) => {
  if (!win) return
  const { ignore, forward } = payload || {}
  try { win.setIgnoreMouseEvents(!!ignore, forward ? { forward: true } : {}) } catch (e) {}
})

// 手写拖拽支持
ipcMain.handle('win:get-position', () => {
  if (!win) return { x: 0, y: 0 }
  const [x, y] = win.getPosition()
  return { x, y }
})
ipcMain.on('win:move', (_e, pos) => {
  if (!win || !pos) return
  win.setPosition(Math.round(pos.x), Math.round(pos.y))
})

// 面板高度随行数/收起态变化:渲染进程 ResizeObserver 上报,这里同步窗口高度。
// 宽度固定,只调高;越出工作区下边界时上移。
ipcMain.on('win:resize', (_e, payload) => {
  if (!win || win.isDestroyed() || !payload || !Number.isFinite(payload.height)) return
  const h = Math.min(600, Math.max(40, Math.round(payload.height)))
  const [w, curH] = win.getSize()
  if (h === curH) return
  const wb = screen.getDisplayMatching(win.getBounds()).workArea
  const [x, y] = win.getPosition()
  win.setBounds({ x, y: Math.min(y, wb.y + wb.height - h), width: w, height: h })
})

// A股代码/名称搜索(腾讯 smartbox)。放主进程:该接口无 CORS 头,渲染进程 fetch 会被拦;
// electron net 走系统代理与真实 app 网络栈一致。返回体是 \uXXXX 转义的纯 ASCII,无需 GBK 解码。
ipcMain.handle('cn:search', (_e, q) => new Promise((resolve) => {
  const url = 'https://smartbox.gtimg.cn/s3/?v=2&t=all&q=' + encodeURIComponent(String(q || '').trim())
  const req = net.request({ url, redirect: 'follow' })
  req.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36')
  let body = ''
  req.on('response', (res) => {
    res.on('data', (c) => (body += c.toString('latin1')))
    res.on('end', () => {
      const out = []
      const m = /v_hint="([^"]*)"/.exec(body)
      if (m && m[1]) {
        for (const item of m[1].split('^')) {
          const seg = item.split('~') // market~code~名称~拼音~类型
          if (seg.length >= 5) {
            let name = seg[2] || ''
            try { name = JSON.parse('"' + name + '"') } catch (e) {} // 解开 \uXXXX
            out.push({ market: seg[0], code: seg[1], name, type: seg[4] })
          }
        }
      }
      resolve(out)
    })
  })
  req.on('error', () => resolve([]))
  req.end()
}))

// ---------- 生命周期 ----------
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => { /* 留在托盘,不退出 */ })
