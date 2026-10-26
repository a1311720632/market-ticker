'use strict'

// ====== 配置与状态 ======
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let config = null
const rows = {}        // id -> { def, el, pxEl, chgEl }
let running = false    // 数据层是否在跑(隐藏时暂停)

let userOpacity = 0.85
let ghostOn = false
let interactMode = false

let pollTimer = null

// ====== 初始化 ======
function init() {
  window.api.getConfig().then((cfg) => {
    config = cfg || {}
    userOpacity = typeof config.opacity === 'number' ? config.opacity : 0.85
    applyOpacity(userOpacity)
    document.getElementById('opacity').value = Math.round(userOpacity * 100)

    applyCollapsed(localStorage.getItem('collapsed') === '1')

    buildRows()
    wireUi()
    wireAddUi()
    watchHeight()
    resumeAll()
  })
}

function buildRows() {
  const list = document.getElementById('list')
  list.textContent = ''
  const symbols = (config.symbols || []).filter(Boolean)
  for (const def of symbols) {
    const row = document.createElement('div')
    row.className = 'row'
    row.title = def.source === 'tencent' ? `${def.label} · ${def.symbol}` : `${def.symbol} (${def.source})`

    const lbl = document.createElement('span')
    lbl.className = 'lbl'
    lbl.textContent = def.label || def.symbol

    const px = document.createElement('span')
    px.className = 'px'
    px.textContent = '--'

    const chg = document.createElement('span')
    chg.className = 'chg'
    chg.textContent = '--'

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '×'
    del.title = '移除该标的'
    del.addEventListener('click', () => removeSymbol(def.id))

    row.appendChild(lbl)
    row.appendChild(px)
    row.appendChild(chg)
    row.appendChild(del)
    list.appendChild(row)
    rows[def.id] = { def, el: row, pxEl: px, chgEl: chg }
  }
}

// ====== 拖拽 + 收起/展开 + 鼠标穿透热区 ======
// 用"光标是否在面板矩形内"动态开关穿透(forward 下 mousemove 仍能收到,比 mouseenter 稳);
// 拖拽走手写 mousedown/mousemove + win.setPosition,不依赖 -webkit-app-region(在透明窗上不稳)。
function wireUi() {
  const panel = document.getElementById('panel')
  const toggle = document.getElementById('toggle')

  toggle.addEventListener('click', () => {
    applyCollapsed(!document.body.classList.contains('collapsed'))
  })

  let dragging = false
  let dragStart = null
  let lastOver = null

  function isOverPanel(e) {
    const r = panel.getBoundingClientRect()
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  }

  document.addEventListener('mousemove', (e) => {
    if (dragging && dragStart) {
      window.api.moveWin(dragStart.wx + (e.screenX - dragStart.mx), dragStart.wy + (e.screenY - dragStart.my))
      return
    }
    if (interactMode) return // 交互模式主进程已 ignore=false,不用管穿透
    const over = isOverPanel(e)
    if (over !== lastOver) {
      lastOver = over
      window.api.setIgnore(!over, true) // 在面板上→可交互;离开→穿透
    }
  })

  panel.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('.chevron, #controls, .del')) return // 箭头/滑块/删除按钮不参与拖拽
    e.preventDefault()
    if (!interactMode) window.api.setIgnore(false, false) // 拖拽期间确保可交互
    window.api.getWinPosition().then((pos) => {
      dragStart = { mx: e.screenX, my: e.screenY, wx: pos.x, wy: pos.y }
      dragging = true
    })
  })

  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; dragStart = null }
  })
}

function applyCollapsed(collapsed) {
  document.body.classList.toggle('collapsed', !!collapsed)
  document.getElementById('toggle').textContent = collapsed ? '▾' : '▴'
  try { localStorage.setItem('collapsed', collapsed ? '1' : '0') } catch (e) {}
}

// ====== 加 / 删自选(A股)======
// 6 位数字自动补市场前缀;前缀冲突时按"个股优先"惯例:
// 000001→平安银行(上证指数请显式输 sh000001)、399001→深证成指自动命中(39 也归深市)。
function normalizeCnCode(raw) {
  const m = /^(sh|sz|bj)?(\d{6})$/.exec(String(raw).trim().toLowerCase())
  if (!m) return null
  if (m[1]) return m[1] + m[2]
  const n = m[2]
  if (/^(43|83|87|88|92)/.test(n)) return 'bj' + n // 北交所(430/83x/87x/88x/920 新段)
  if (/^[569]/.test(n)) return 'sh' + n            // 60/68 股票、51/56/58 基金、900 B股
  if (/^[0123]/.test(n)) return 'sz' + n           // 00/30 股票、15/16/18 基金、39 指数、12 转债
  return null
}

// 名称/拼音搜索:主进程代查 smartbox(无 CORS 头),取第一个 A股/指数/场内基金结果
async function searchCnSymbol(q) {
  const list = (await window.api.cnSearch(q)) || []
  const hit = list.find((x) =>
    /^(sh|sz|bj)$/.test(x.market) && ['GP-A', 'ZS', 'ETF', 'LOF', 'FJ'].includes(x.type))
  return hit ? hit.market + hit.code : null
}

function removeSymbol(id) {
  const r = rows[id]
  if (!r) return
  config.symbols = (config.symbols || []).filter((s) => s.id !== id)
  window.api.patchConfig({ symbols: config.symbols })
  buildRows()
  restartCnLane() // 行情通道立即对齐新列表
  pollOnce()
}

function wireAddUi() {
  const input = document.getElementById('add-code')
  const btn = document.getElementById('add-btn')
  const msgEl = document.getElementById('add-msg')
  let msgTimer = null
  function setMsg(text, isErr) {
    msgEl.textContent = text || ''
    msgEl.classList.toggle('err', !!isErr)
    clearTimeout(msgTimer)
    if (text) msgTimer = setTimeout(() => { msgEl.textContent = '' }, 3500)
  }

  async function addCn() {
    const raw = input.value.trim()
    if (!raw) return
    setMsg('查询中…')
    try {
      let symbol = normalizeCnCode(raw)
      if (!symbol) symbol = await searchCnSymbol(raw)
      if (!symbol) return setMsg('没找到,试试 6 位代码 / sh000001 / 名称拼音', true)

      const quotes = await fetchTencentBatch([symbol]) // 顺带校验代码有效 + 拿中文名
      const q = quotes[symbol]
      if (!q || !q.name) return setMsg(`${symbol} 无行情(代码不存在或不支持)`, true)
      if ((config.symbols || []).some((s) => s.symbol === symbol)) return setMsg(`${q.name} 已在列表中`, true)

      config.symbols = config.symbols || []
      config.symbols.push({ id: symbol, label: q.name, source: 'tencent', symbol })
      window.api.patchConfig({ symbols: config.symbols })
      buildRows()
      restartCnLane()
      setMsg(`已添加 ${q.name}`)
      input.value = ''
    } catch (e) {
      setMsg('查询失败:' + e.message, true)
    }
  }

  btn.addEventListener('click', addCn)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCn() })
}

// 面板高度随行数/收起/交互态变化,同步窗口高度(transparent 窗固定宽、高度交给内容)
function watchHeight() {
  const panel = document.getElementById('panel')
  new ResizeObserver(() => {
    window.api.resizeWin(Math.ceil(panel.offsetHeight) + 4)
  }).observe(panel)
}

// ====== 渲染单个标的 ======
function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '--'
  const d = v >= 1 ? 2 : 4
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}
function fmtChg(p) {
  if (p == null || !isFinite(p)) return '--'
  return (p >= 0 ? '+' : '') + p.toFixed(2) + '%'
}

function updateRow(id, { price, changePct, marketState }) {
  const r = rows[id]
  if (!r) return
  r.pxEl.textContent = fmtPrice(price)
  r.chgEl.textContent = fmtChg(changePct)

  const colors = config.colors || { up: '#22c55e', down: '#ef4444' }
  // A股行按国内惯例红涨绿跌,其它(美股/币)沿用全局配色(默认绿涨红跌)
  const isCn = r.def.source === 'tencent'
  const up = isCn ? (colors.cnUp || '#ef4444') : colors.up
  const down = isCn ? (colors.cnDown || '#22c55e') : colors.down
  let col = '#94a3b8'
  if (changePct != null && isFinite(changePct)) {
    if (changePct > 0.001) col = up
    else if (changePct < -0.001) col = down
  }
  r.pxEl.style.color = col
  r.chgEl.style.color = col

  const closed = marketState && !['REGULAR', 'PRE', 'POST', 'PREPRE'].includes(marketState)
  r.el.classList.toggle('closed', closed)
}

function failRow(id) {
  const r = rows[id]
  if (!r) return
  r.pxEl.textContent = '获取失败'
  r.pxEl.style.color = '#64748b'
  r.chgEl.textContent = '--'
  r.chgEl.style.color = '#64748b'
}

// ====== 黄金 / 美股期货:Yahoo v8 chart(无 auth,逐 symbol)======
// 涨跌幅用 meta.chartPreviousClose(前一交易日收盘)做基线,是真正的"当日涨跌"。
async function fetchYahoo(symbol) {
  const url =
    'https://query2.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?interval=1d&range=1d'
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error('yahoo ' + r.status)
  const j = await r.json()
  const res = j && j.chart && j.chart.result && j.chart.result[0]
  if (!res) throw new Error('yahoo empty')
  const m = res.meta || {}
  const price = m.regularMarketPrice
  const prev = m.chartPreviousClose ?? m.previousClose ?? m.regularMarketPreviousClose
  const changePct = prev && Number.isFinite(prev) ? ((price - prev) / prev) * 100 : null
  return { price, changePct, marketState: m.marketState }
}

// ====== 加密币:OKX 公共 REST ======
// 原走 wss://ws.okx.com 长连接,但该 WS 通道在大陆网络被墙(443/8443 均连不上);
// www.okx.com 的 REST 仍可达,遂改 REST 轮询,与 Yahoo 同走 pollOnce。
// 涨跌幅用 open24h(24h 开盘)做基线。
async function fetchOkx(symbol) {
  const url = 'https://www.okx.com/api/v5/market/ticker?instId=' + encodeURIComponent(symbol)
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error('okx ' + r.status)
  const j = await r.json()
  const d = j && j.data && j.data[0]
  if (!d) throw new Error('okx empty')
  const price = parseFloat(d.last)
  const open = parseFloat(d.open24h)
  const changePct = open && Number.isFinite(open) ? ((price - open) / open) * 100 : null
  return { price, changePct, marketState: 'REGULAR' }
}

const FETCHERS = { yahoo: fetchYahoo, okx: fetchOkx }

// ====== A股:腾讯行情 qt.gtimg.cn(大陆可达,批量一次请求,无 Key)======
// 返回 GBK 文本:v_sh600519="1~贵州茅台~600519~现价~昨收~...~时间~涨跌~涨跌幅~..."
// 字段(~ 分隔):1=名称 3=现价 4=昨收 30=时间yyyymmddHHMMSS 31=涨跌 32=涨跌幅%
let gbkDecoder = null
function decodeGbk(buf) {
  if (!gbkDecoder) gbkDecoder = new TextDecoder('gbk')
  return gbkDecoder.decode(buf)
}

async function fetchTencentBatch(symbols) {
  const url = 'https://qt.gtimg.cn/q=' + symbols.join(',')
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error('tencent ' + r.status)
  const text = decodeGbk(await r.arrayBuffer())
  const out = {}
  for (const m of text.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
    const f = m[2].split('~')
    const price = parseFloat(f[3])
    if (f.length < 33 || !Number.isFinite(price)) continue // 无效代码返回 v_pv_none_match,这里自然被过滤
    out[m[1]] = { name: f[1], price, changePct: parseFloat(f[32]), time: f[30] }
  }
  return out
}

// A股交易时段(含 9:15 集合竞价):周一~周五 9:15-11:30 / 13:00-15:00,按北京时间算,不受系统时区影响
function isCnTradingTime() {
  const t = new Date(Date.now() + 8 * 3600 * 1000)
  const day = t.getUTCDay()
  if (day === 0 || day === 6) return false
  const hm = t.getUTCHours() * 60 + t.getUTCMinutes()
  return (hm >= 555 && hm < 690) || (hm >= 780 && hm < 900)
}

// 行情时间戳距现在 < 6 分钟视为盘中(交易所时间=北京时间)。
// 用它而不是只看钟表,能顺带正确识别:午休、停牌(如 bj430047 时间戳停在 9:00)、节假日(全冻结)。
function cnQuoteFresh(timeStr) {
  if (!/^\d{14}$/.test(timeStr || '')) return null
  const t = Date.UTC(+timeStr.slice(0, 4), +timeStr.slice(4, 6) - 1, +timeStr.slice(6, 8),
                     +timeStr.slice(8, 10) - 8, +timeStr.slice(10, 12), +timeStr.slice(12, 14))
  const age = Date.now() - t
  return age >= 0 && age < 6 * 60 * 1000
}

async function pollOnce() {
  const defs = (config.symbols || []).filter((s) => FETCHERS[s.source])
  for (const def of defs) {
    if (!running) return
    let err = null
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        updateRow(def.id, await FETCHERS[def.source](def.symbol))
        err = null
        break
      } catch (e) {
        err = e
        await sleep(500 * (attempt + 1))
      }
    }
    if (err) {
      console.warn('[poll]', def.symbol, err.message)
      failRow(def.id)
    }
    await sleep(250)
  }
}

// ====== A股轮询通道(独立于 pollOnce:批量单请求 + 按开盘状态自适应频率)======
// 盘中(时间戳新鲜)3 秒级实时;钟表在时段内但行情冻结(节假日/集合竞价未撮合)降到 20 秒;
// 时段外 60 秒,维持收盘价与跨日刷新。失败不重试,下一轮自然覆盖(最快 3 秒后)。
let cnTimer = null
let cnAnyFresh = false

function cnDefs() {
  return (config.symbols || []).filter((s) => s.source === 'tencent' && /^(sh|sz|bj)\d{6}$/.test(s.symbol))
}

async function pollCn() {
  if (!running) return
  const defs = cnDefs()
  if (!defs.length) { cnTimer = setTimeout(pollCn, 60 * 1000); return }
  try {
    const quotes = await fetchTencentBatch(defs.map((d) => d.symbol))
    let anyFresh = false
    for (const def of defs) {
      const q = quotes[def.symbol]
      if (q && q.name) {
        const fresh = cnQuoteFresh(q.time)
        if (fresh) anyFresh = true
        const state = fresh === null ? (isCnTradingTime() ? 'REGULAR' : 'CLOSED') // 时间戳异常按钟表兜底
                                    : (fresh ? 'REGULAR' : 'CLOSED')
        updateRow(def.id, { price: q.price, changePct: q.changePct, marketState: state })
      } else {
        failRow(def.id)
      }
    }
    cnAnyFresh = anyFresh
  } catch (e) {
    console.warn('[cn]', e.message)
    for (const def of defs) failRow(def.id)
  }
  const sec = isCnTradingTime() ? (cnAnyFresh ? Math.max(2, config.cnPollIntervalSec || 3) : 20) : 60
  cnTimer = setTimeout(pollCn, sec * 1000)
}

// 增删标的后立即对齐新列表(清掉排程,马上拉一次)
function restartCnLane() {
  if (cnTimer) { clearTimeout(cnTimer); cnTimer = null }
  pollCn()
}

function startPoll() {
  stopPoll()
  pollOnce()
  const sec = Math.max(5, config.pollIntervalSec || 30)
  pollTimer = setInterval(pollOnce, sec * 1000)
  pollCn()
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (cnTimer) { clearTimeout(cnTimer); cnTimer = null }
}

// ====== 暂停 / 恢复(随隐藏切换)======
function pauseAll() { running = false; stopPoll() }
function resumeAll() {
  if (running) return
  running = true
  startPoll()
}

// ====== 透明度 / 模式 ======
function applyOpacity(o) {
  document.documentElement.style.opacity = String(o)
}

window.api.onInteract((on) => {
  interactMode = !!on
  document.body.classList.toggle('interact', interactMode)
  if (interactMode) {
    document.getElementById('opacity').value = Math.round(userOpacity * 100)
  }
})
window.api.onVisibility((visible) => { visible ? resumeAll() : pauseAll() })
window.api.onGhost(() => {
  ghostOn = !ghostOn
  document.body.classList.toggle('ghost', ghostOn)
  applyOpacity(ghostOn ? (config.ghostOpacity ?? 0.08) : userOpacity)
})

document.getElementById('opacity').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10) / 100
  userOpacity = v
  ghostOn = false
  document.body.classList.remove('ghost')
  applyOpacity(v)
  window.api.saveOpacity(v)
})

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

init()
