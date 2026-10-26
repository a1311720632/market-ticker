# 打工人悬浮行情条 (market-ticker)

一个悬浮在桌面、上班时偷偷盯盘的行情小组件。实时显示黄金、比特币、美股指数,支持 watchlist、可调透明度、一键隐藏。

- **A股**:腾讯行情(`qt.gtimg.cn`,大陆可达、无需 Key),**盘中 3 秒级实时**;支持股票 / 指数 / ETF / 场内基金 / 北交所,界面上直接输入代码或名称添加,悬浮行点 `×` 删除。
- **黄金 / 美股**:Yahoo Finance(`query2.finance.yahoo.com` 的 v8 chart 接口,无需 Key),每 30 秒刷新。
- **加密币**:OKX 公共 REST,30 秒轮询。
- 默认鼠标**穿透**(不挡工作),全局热键切交互;**老板键**一键隐藏到托盘并暂停拉数据;**透明度滑块 + 幽灵模式**低调常驻。

## 运行

```bash
cd market-ticker
npm install
npm start
```

## 快捷键(可在 `config.json` 的 `hotkeys` 改)

| 键 | 作用 |
|---|---|
| `Ctrl + ` ` | 切换交互 / 穿透模式(交互态可拖动、调透明度) |
| `Ctrl + Shift + H` | 老板键:彻底隐藏到托盘(再按恢复);隐藏期间暂停拉数据 |
| `Ctrl + Shift + G` | 幽灵模式:透明度降到 `ghostOpacity`(默认 8%) |

托盘图标右键也有「显示/隐藏」「退出」。

平时整窗鼠标穿透。**把鼠标移到面板上**,面板就变成可交互:在任意位置**按住拖动**即可移动它;点右上角 `▴` 收起(只剩一条小标签),再点 `▾` 展开。鼠标移开即恢复穿透,不挡下面的工作软件。收起时数据仍在后台更新,展开即是最新。

## 加自选 / 删自选

**A股 —— 界面上直接加**:按 `Ctrl + ~` 进入交互模式,底部输入框填 **6 位代码**(如 `600519`)或**名称/拼音**(如 `茅台`/`maotai`),回车即加,标签自动用股票中文名。悬浮到某一行,行尾出现 `×`,点一下即删。

- 6 位纯数字自动识别市场:`600519`→沪、`000001`→深(平安银行)、`300750`→创业板、`399001`→深证成指、`510300`→沪 ETF、`430047`→北交所。
- 个股/指数前缀冲突时按个股优先:`000001` 是平安银行,上证指数请显式输 **`sh000001`**。
- 盘中(9:15–11:30 / 13:00–15:00)3 秒级刷新(`cnPollIntervalSec` 可调);午休/收盘/停牌自动降频并淡化显示;节假日不依赖日历,按行情时间戳是否新鲜自动识别。

**美股 / 币 —— 改配置文件**(v0.1 方式,重启生效)。配置文件位置:`%APPDATA%\market-ticker\config.json`(首次启动从 `config.default.json` 自动生成)。在 `symbols` 数组里加一条:

```json
{
  "symbols": [
    { "id": "sh000001", "label": "上证", "source": "tencent", "symbol": "sh000001" },
    { "id": "gold",   "label": "金",   "source": "yahoo", "symbol": "GC=F" },
    { "id": "btc",    "label": "BTC",  "source": "okx",   "symbol": "BTC-USDT" },
    { "id": "nasdaq", "label": "纳指", "source": "yahoo", "symbol": "NQ=F" },
    { "id": "sp500",  "label": "标普", "source": "yahoo", "symbol": "ES=F" },
    { "id": "aapl",   "label": "AAPL", "source": "yahoo", "symbol": "AAPL" },
    { "id": "eth",    "label": "ETH",  "source": "okx",   "symbol": "ETH-USDT" }
  ]
}
```

- `source: "tencent"` → 走腾讯行情 A股通道(大陆可达)。符号形如 `sh600519`、`sz000001`、`sh000001`(上证指数)、`sz399006`(创业板指)、`sh510300`(ETF)、`bj430047`(北交所)。
- `source: "yahoo"` → 走 Yahoo v8 chart 轮询。符号示例:`GC=F`(金期,**默认**)、`NQ=F`(纳指期)、`ES=F`(标普期)、`YM=F`(道指期)、`AAPL` 等任意美股/ETF。涨跌幅用「前一日收盘」做基线(Yahoo `chartPreviousClose`),是真正的当日涨跌。注:`XAUUSD=X`(金现)在 chart 接口会 404,所以金用期货 `GC=F`(与现货价差很小,涨跌几乎一致)。
- `source: "okx"` → 走 OKX REST 轮询。符号形如 `BTC-USDT`、`ETH-USDT`、`SOL-USDT`。

## 其它可调项

- `opacity` / `ghostOpacity`:正常 / 幽灵模式整体透明度(0~1)。
- `pollIntervalSec`:Yahoo / OKX 轮询间隔(秒),默认 30。
- `cnPollIntervalSec`:A股盘中刷新间隔(秒),默认 3(休市自动降到 60)。
- `colors.up` / `colors.down`:涨跌颜色(美股/币,默认绿涨红跌);`colors.cnUp` / `colors.cnDown`:A股配色,默认红涨绿跌(国内惯例)。
- `disableHardwareAcceleration`:**透明窗出现黑/灰底时设为 `true`**(部分 Windows + NVIDIA 驱动会这样),然后重启。

## 故障排查

- **窗口背景是黑的不是透明的** → 把 `config.json` 里 `disableHardwareAcceleration` 改成 `true`,重启。
- **行情显示「获取失败」** → 多半是 Yahoo 被限频或网络问题;稍等会自动重试。VPN/代理没开时加密币也连不上交易所。想知道到底是哪个源不通,跑一遍自检:`npx electron scripts/check-sources.cjs`(注意:必须经 electron 跑才会走系统代理;Node 直接跑会误报失败)。
- **快捷键没反应** → 可能被别的软件占用;改 `config.json` 里的 `hotkeys` 换个组合,重启。

## 说明

- Yahoo 接口为非官方,未来可能变化;失败时会显示「获取失败」而非崩溃。
- 数据仅供参考,交易决策请以券商/交易所为准。

## v0.2 计划(本期不做)

美股/币的图形化加自选、每行 sparkline、开机自启、多主题、打包成 exe、hover 区域智能穿透。
