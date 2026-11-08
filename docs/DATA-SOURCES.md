# 数据源细节

记录逆向与实测过程，避免下次重新摸索。**所有结论都经过实际请求验证**，未验证的会明确标注。

## 一、京东金融代销渠道（主源，六家）

一个接口覆盖浙商/民生/工商/广发/兴业/中信，零登录，实测约 90~350ms。

```
POST https://api.jdjygold.com/gw2/generic/hj/h5/m/cfBatchGetLatestPriceInfo
Content-Type: application/json
Referer: https://m.jdjygold.com/
Origin: https://m.jdjygold.com

{"productSkus":["1961543816","21001001000001","2005453243","2024345112","2039007297","2045976593"]}
```

也可用表单形式 `reqData=<json>`，两种都实测可用。

### sku 与银行

| sku | 银行 | `Quote.label` |
|---|---|---|
| `1961543816` | 浙商 | 浙商 |
| `21001001000001` | 民生 | 民生 |
| `2005453243` | 工商 | 工商 |
| `2024345112` | 广发 | 广发 |
| `2039007297` | 兴业 | 兴业 |
| `2045976593` | 中信 | 中信 |

映射来自京东黄金频道页 bundle（`/fg/channel/js/index-*.js`）里写死的 `cfBatchGetLatestPriceInfo` 回调代码，不是猜的。同一处还显示 `2002735994` 会归并到浙商。

### 返回字段

```json
{"resultData":{"code":"00000000","data":[{
  "productSku":"1961543816",
  "buyPrice":"885.39",        // 客户买入价（你买要付的）
  "sellPrice":"885.39",       // 客户卖出价（你赎回拿到的）
  "price":"885.39",
  "yesterdayPrice":"869.22",  // 昨收（买入侧）
  "sellYesterdayPrice":"869.22",
  "upAndDownRate":"+1.86%",   // 相对昨收的涨跌幅，带正负号与百分号
  "sellUpAndDownRate":"+1.86%",
  "upAndDownAmt":"+16.17",
  "time":"1793871505000",     // 毫秒时间戳
  "priceNum":"..."            // 各行格式不同，工商形如 ICBCGOLD_20261105173821057000
}]}}
```

- `resultData.code` 必须是 `"00000000"`。
- **没有费率字段**：五个产品的 DTO 全键名已核（`queryCommonGoldProductInfoNew`），只有 `preClose` / `raisePercent` / `trading` 等。所以费率只能人工维护（见 `core/fees.ts`）。
- **部分银行只给单边价**：浙商/民生/工商/中信的 `buyPrice == sellPrice`，点差恒 0，不代表免费。
- **各家"昨收"口径不同**：同一时刻工商可能 `-1.4%`、其余 `-0.4%`。指数不要跨行比较。

### 其它可用的京东端点（未接入，供扩展）

| 端点 | 用途 | 是否需要登录 |
|---|---|---|
| `POST /gw2/generic/CreatorSer/newh5/m/getFirstRelatedProductInfo` | 单个产品的实时价 + 日内分时序列 `icLineChart.lineDataList` | 否 |
| `POST /gw2/generic/CfGoldWeb/h5/m/queryCommonGoldProductInfoNew` | 产品列表（含 `preClose`、交易时段） | 否 |
| `GET /gw2/generic/jrm/h5/m/listGetGoldProductsQry` | 产品列表分页 | 否 |
| `POST /gw2/generic/hj/h5/m/cfGetHoldingList` | 持仓 | 需要 |
| `latest.umd.js` 里的 `jdCfGoldPriceSelf.on(sku, cb)` | 长连接推送 | 否（页面内 SDK） |

### 快速验证

```bash
curl -s -X POST https://api.jdjygold.com/gw2/generic/hj/h5/m/cfBatchGetLatestPriceInfo \
  -H 'content-type: application/json' -H 'referer: https://m.jdjygold.com/' \
  -d '{"productSkus":["1961543816"]}'
```

## 二、建行公开行情（辅源）

```
GET https://wealth.ccb.com/cn/home/news/zhgjs_new.xml
```

无需登录，无反爬，实测约 0.3s。

### 字段

```xml
<ReferencePriceSettlement>
  <PM_Txn_Vrty_Cd>01</PM_Txn_Vrty_Cd>   <!-- 品种码 -->
  <CcyCd>156</CcyCd>                     <!-- 156=人民币/克，840=美元/盎司 -->
  <Cst_Buy_Prc>885.24</Cst_Buy_Prc>      <!-- 客户买入价 -->
  <MdlRate>884.99</MdlRate>              <!-- 中间价 -->
  <Cst_Sell_Prc>884.74</Cst_Sell_Prc>    <!-- 客户卖出价 -->
  <Tms>2026-11-05 16:49:48.633</Tms>     <!-- 北京时间 -->
</ReferencePriceSettlement>
```

**字段语义已用页面表格交叉验证**：页面上 AU9999 显示"客户买入价 840.99 / 客户卖出价 840.49"，与 XML 中 `Cst_Buy_Prc > Cst_Sell_Prc` 一致。注意建行前端 JS 里的注释把这两个字段写反了，不要被误导。

### 品种码

| 码 | 含义 | 类型 |
|---|---|---|
| `01` | 账户黄金 Au99.99 | 实时 |
| `02` | 账户黄金 Au99.95 | 实时 |
| `23` | 黄金积存当日价 | 每日 10:30 定价 |

账户金页面的 `SEC_COD_MAP` 只给实时品种配走势图，不含 23；但同一页的 `getGoldStore()` 明确写着「输入 01 查赎回价，输入 23 查积存价」，并在码为 23 时把列名切成「当日积存价」。因此 `23 = 黄金积存当日价` **已确认**（2026-11-06），不是推断。该函数读的是 `gjshjjc01.xml`（已冻结），我们改从 `zhgjs_new.xml` 取同码，时间戳会每日滚到 10:30。

口径注意：23 的买入价每天 10:30 固定，赎回价（`Cst_Sell_Prc`）盘中仍会变，而 `Tms` 始终停在 10:30。所以 `buyPrice - sellPrice` 是「日定价 + 实时赎回价」的混合值（2026-11-06 10:30 后约 10.9~11.6 元，10:30 前 18~20 元），**不是对称买卖点差**，不能和其他实时品种横向比较。

### 已证伪、不要再用

| 资源 | 现象 |
|---|---|
| `/cn/home/news/gjshjjc01.xml`（黄金积存） | 冻结在 2026-07-27，三个多月未更新 |
| `/cn/home/news/shhjhq.xml`（上金所行情） | 冻结在 2024-12-19 |
| `/cn/home/news/gjszhspbj01.xml`、`gjszhspqz01.xml` | 是账户原油，且停留在 2026-07-28 |
| `/cn/home/news/trendchart/day/888888.js` | 静态挡板，`?sec_code=` 传任何值返回相同数据，且数值区间与积存金真实价不符 |

### 快速验证

```bash
curl -s 'https://wealth.ccb.com/cn/home/news/zhgjs_new.xml'
```

## 三、交易时段与休市日历

积存金不是 24 小时连续交易，但也不同于股票：日盘 15:30 收盘后直接进入夜盘，跨过零点到次日凌晨。`core/market.ts` 按北京时间维护：

- **常规连续盘**：周一 09:00 → 周六 02:30（周五夜盘）。凌晨 00:00–02:30 属于前一交易日的夜盘。
- **各家实测收盘点**（2026-11-07 本地 `quotes.json` 最后一笔时间戳）：工商 22:30，广发/兴业/中信/民生 02:00，浙商 02:30；账户金与建行日价不受会话约束。取并集，避免"还有一家开着却被判全部陈旧"。
- **周末**：周六 02:30 后至周一 09:00 休市。
- **法定节假日**：按上金所《关于 2026 年休市安排的通知》整段休市；节前最后一个交易日晚上停夜盘，节假日最后一天凌晨（00:00–02:30）也按休市处理。
- **调休补班**：周末补班对办公室是工作日，对市场仍是休市。

**维护**：`MARKET_SCHEDULE_AS_OF` 记录最近核对日期。每年交易所公布下一年安排后更新 `HOLIDAY_RANGES` / `NO_NIGHT_EVENINGS`，并跑 `verify:display`——时段边界断言会随表失效而失败。

来源：

- 上海黄金交易所 2026 年休市安排通知（2025 年 11 月发布），与上期所 2026 年节假日休市表逐条比对一致。
- 广发银行积存金交易时间公告：日盘 09:00–15:30，夜盘 15:30–次日 02:00，与实测时间戳吻合。
- 收盘时间戳实测见上。

## 四、风险与合规

- 京东接口是**逆向得到的非官方接口**，可能随时改字段、加签名或加风控。`probe` 就是用来第一时间发现它坏掉的。
- 请求频率过高可能触发风控。默认 30 秒；1 秒档保留给用户自选，但不要作为默认值。
- 仅抓取公开行情，不涉及用户账号、持仓、交易。Bark device key 属于用户凭据，只存本机 `userData`。
- 数据仅供个人参考，界面与文档都要保留"不构成投资建议"的表述。
