// 数据源可达性自检 —— 走 Electron 自带网络栈(即真实 app 用的路径,会读取系统代理)。
// 这点很关键:Node 原生 fetch/WebSocket 不走系统代理,会误报失败;必须用本脚本经 electron 跑。
// 用法: npx electron scripts/check-sources.cjs
'use strict'
const { app, net, BrowserWindow } = require('electron')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
app.setName('mt-check')

function get(url) {
  return new Promise((resolve) => {
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', UA)
    let body = ''
    req.on('response', (res) => {
      res.on('data', (c) => (body += c.toString()))
      res.on('end', () => {
        let extra = ''
        if (res.statusCode === 200) {
          try { const m = JSON.parse(body).chart.result[0].meta; extra = ` price=${m.regularMarketPrice}` } catch (e) {}
        }
        console.log(`  Yahoo ${res.statusCode}  ${url}${extra}`)
        resolve()
      })
    })
    req.on('error', (e) => { console.log(`  Yahoo ERROR  ${url}  ${e.message}`); resolve() })
    req.end()
  })
}

// 在真实渲染器里跑 fetch(与 app 的币价 REST 通道完全一致,走系统代理)。
// 注意:OKX 的 WebSocket 通道 ws.okx.com 在大陆被墙(443/8443 均连不上),币价改走 REST。
const REST_JS = `fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT')
  .then(r => r.json())
  .then(j => j.data ? ('OK  BTC-USDT last=' + j.data[0].last + ' open24h=' + j.data[0].open24h) : ('resp=' + JSON.stringify(j).slice(0,120)))
  .catch(e => 'REST错误: ' + e.message)
`

app.whenReady().then(async () => {
  console.log('=== 黄金 / 美股期货 / 个股(Yahoo v8 chart)===')
  await get('https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d')
  await get('https://query2.finance.yahoo.com/v8/finance/chart/NQ=F?interval=1d&range=1d')
  await get('https://query2.finance.yahoo.com/v8/finance/chart/ES=F?interval=1d&range=1d')
  await get('https://query2.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=1d')
  console.log('=== A股(腾讯 qt.gtimg.cn,app 的 A股通道)===')
  await new Promise((resolve) => {
    const req = net.request({ url: 'https://qt.gtimg.cn/q=sh600519,sz000001,sh000001', redirect: 'follow' })
    req.setHeader('User-Agent', UA)
    let body = ''
    req.on('response', (res) => {
      res.on('data', (c) => (body += c.toString('latin1'))) // GBK 名称会乱码,数值字段是 ASCII 可校验
      res.on('end', () => {
        for (const m of body.matchAll(/v_((?:sh|sz|bj)\d{6})="([^"]*)"/g)) {
          const f = m[2].split('~')
          if (f.length >= 33) console.log(`  腾讯 200  ${m[1]}  price=${f[3]}  涨跌幅=${f[32]}%  时间=${f[30]}`)
        }
        if (!/v_(?:sh|sz|bj)\d{6}="/.test(body)) console.log(`  腾讯 ${res.statusCode}  响应异常: ${body.slice(0, 80)}`)
        resolve()
      })
    })
    req.on('error', (e) => { console.log(`  腾讯 ERROR  ${e.message}`); resolve() })
    req.end()
  })
  console.log('=== 加密币(OKX 公共 REST)===')
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false } })
  win.loadURL('about:blank')
  try { console.log('  OKX  ' + await win.webContents.executeJavaScript(REST_JS, true)) }
  catch (e) { console.log('  OKX  执行异常 ' + e.message) }
  console.log('=== 完成 ===')
  app.quit()
})
