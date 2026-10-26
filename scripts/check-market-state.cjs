// 临时诊断:连拉两轮(间隔 35s),看 Yahoo 期货的 marketState 与价格是否在动
// 用法: npx electron scripts/check-market-state.cjs
'use strict'
const { app, net } = require('electron')
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
app.setName('mt-check-state')

const SYMBOLS = ['GC=F', 'NQ=F', 'ES=F']

function getMeta(symbol) {
  return new Promise((resolve) => {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
    const req = net.request({ url, redirect: 'follow' })
    req.setHeader('User-Agent', UA)
    let body = ''
    req.on('response', (res) => {
      res.on('data', (c) => (body += c.toString()))
      res.on('end', () => {
        try {
          const m = JSON.parse(body).chart.result[0].meta
          resolve({ symbol, price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose, state: m.marketState, ts: m.regularMarketTime })
        } catch (e) { resolve({ symbol, err: body.slice(0, 80) }) }
      })
    })
    req.on('error', (e) => resolve({ symbol, err: e.message }))
    req.end()
  })
}

app.whenReady().then(async () => {
  for (let round = 1; round <= 2; round++) {
    console.log(`--- 第 ${round} 轮 ${new Date().toLocaleTimeString()} ---`)
    for (const s of SYMBOLS) {
      const r = await getMeta(s)
      if (r.err) console.log(`  ${r.symbol}  ERROR ${r.err}`)
      else console.log(`  ${r.symbol}  price=${r.price}  prev=${r.prev}  state=${r.state}  regTime=${new Date(r.ts * 1000).toLocaleTimeString()}`)
    }
    if (round === 1) await new Promise((r) => setTimeout(r, 35000))
  }
  app.quit()
})
