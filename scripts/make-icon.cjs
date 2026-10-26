// 生成托盘 / 应用图标 icon.png(32x32,纯 Node + zlib,无外部依赖)。
// 用法: node scripts/make-icon.cjs
// 画一个绿色圆角方块带白色细边的简洁图标。需要换图标时改本文件后重跑即可。
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const W = 32, H = 32
const GREEN = [34, 197, 94, 255]   // #22c55e
const WHITE = [255, 255, 255, 255]
const CLEAR = [0, 0, 0, 0]

// 圆角方块 SDF(中心 15.5,半边 13.5,圆角半径 7)
function roundedDist(x, y) {
  const cx = 15.5, cy = 15.5, half = 13.5, r = 7
  const dx = Math.abs(x - cx)
  const dy = Math.abs(y - cy)
  const qx = dx - (half - r)
  const qy = dy - (half - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0)
}

// 画一个小幅 K 线(两根:一红一绿)叠加在绿色块之上 —— 让它"像行情"
function candlePixel(x, y) {
  // 两根蜡烛,中心对称
  // 左蜡烛(下跌,红):x=10..13,体 y=12..19,影 y=9..21
  // 右蜡烛(上涨,绿/亮):x=19..22,体 y=11..18,影 y=8..20
  const inV = (x, lo, hi) => x >= lo && x <= hi
  // 左红蜡烛
  if (x >= 11 && x <= 12) {
    if (y === 9 || y === 10 || y === 20 || y === 21) return WHITE // 影线
    if (y >= 11 && y <= 19) return [255, 80, 80, 255]
  }
  // 右白蜡烛(用白色当"上涨亮色",在绿底上跳出来)
  if (x >= 20 && x <= 21) {
    if (y === 8 || y === 9 || y === 20) return WHITE
    if (y >= 10 && y <= 19) return WHITE
  }
  return null
}

// 构造原始像素数据(每行前加 filter 字节 0)
const raw = Buffer.alloc((W * 4 + 1) * H)
let p = 0
for (let y = 0; y < H; y++) {
  raw[p++] = 0 // filter: None
  for (let x = 0; x < W; x++) {
    const d = roundedDist(x, y)
    let px
    if (d > 0) {
      px = CLEAR
    } else if (d > -1.2) {
      px = WHITE // 细白边
    } else {
      px = GREEN
    }
    const c = candlePixel(x, y)
    if (c) px = c
    raw[p++] = px[0]; raw[p++] = px[1]; raw[p++] = px[2]; raw[p++] = px[3]
  }
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 6   // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const idat = zlib.deflateSync(raw, { level: 9 })

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
])

const out = path.join(__dirname, '..', 'icon.png')
fs.writeFileSync(out, png)
console.log('wrote', out, '(' + png.length + ' bytes)')
