# GoldSentry

监控多家银行**积存金**实时价，到价 / 涨跌幅提醒，多渠道推送。当前有 **Mac 菜单栏**、**Windows 托盘（含任务栏文字与悬浮球）** 和 **VS Code 状态栏** 三种形态，共用同一套与端无关的核心逻辑。

> 数据来源为公开行情接口（含逆向接口），仅供个人参考，不构成投资建议。

## 当前状态

| 形态 | 状态 | 说明 |
|---|---|---|
| Mac 菜单栏 App | 可运行，已出未签名 `.dmg` | 托盘实时价、六家银行对比、到价提醒、原生通知 + Bark 推送 |
| Windows 托盘 App | 源码/开发态可运行；已出 portable / NSIS，本机安装版被 Smart App Control 拦（未签名） | 托盘实时价、**任务栏文字**（TrafficMonitor 式贴附，全屏应用时自动隐藏）、**可调透明度悬浮球**、到价提醒、Bark 推送 |
| VS Code 扩展 | 可运行 | 状态栏实时价、左键 QuickPick 对比表、4 个命令、提醒、Bark 推送 |
| 浏览器插件 | 未开始 | 核心可直接复用，只差外壳 |

核心能力已验证：多源取数、穿越触发提醒、源失效检测（三态）、Bark 推送（含失败上报）、金额两位小数、面板分时折线与 Windows 任务栏贴附几何。

## 快速开始

```bash
pnpm install          # 需要 pnpm 10+；Node >= 22.18（用原生 TS 直跑，无构建步骤）
npm run probe         # 拉一次真实行情，打印全部品种，最快验证网络与解析
```

Mac 菜单栏 / Windows 托盘：

```bash
npm run menubar          # 开发模式（先 bundle 再启动 Electron）
npm run menubar:dist     # Mac 出 dmg，产物在 apps/menubar/release/
npm run menubar:dist:win # Windows 出 portable + NSIS
```

VS Code 扩展：

```bash
npm run vscode:install   # 构建并拷到 ~/.vscode/extensions/goldsentry-vscode
# 然后在 VS Code 里执行 Developer: Reload Window
```

验证套件（不依赖界面）：

```bash
npm run verify:all
```

## 架构

```
packages/core/          与端无关的全部逻辑，纯 TS，无第三方依赖
  src/types.ts          Quote / QuoteSource 契约
  src/sources/jd.ts     京东金融代销渠道（浙商/民生/工商/广发/兴业/中信，实时）
  src/sources/ccb.ts    建行账户贵金属 + 积存金当日定价
  src/store.ts          样本落盘、当日涨跌幅基准、规则锁存状态、健康状态
  src/alerts.ts         到价 / 涨跌幅规则（上升沿触发）
  src/health.ts         数据源三态健康判断（含"成功但数据冻结"）
  src/trend.ts          当日分时序列（北京时间分桶、断档切分、降采样）
  src/fees.ts           人工核实的费率表（接口无此字段）
  src/notify.ts         Bark 推送
  src/poller.ts         取数 → 落样本 → 判断提醒与健康
  src/format.ts         金额/涨跌幅两位小数、透明度与窗口夹取
  src/taskbar.ts        从 bounds/workArea 推断任务栏位置（四边、自动隐藏）

apps/menubar/           Electron 薄壳（TS 源码 → esbuild bundle → asar；Mac 菜单栏 + Windows 托盘/任务栏文字/悬浮球）
apps/vscode/            VS Code 扩展（esbuild bundle，复用 core）
scripts/                probe 与四套 verify 脚本
docs/                   变更记录、路线图、数据源细节
```

设计原则：**逻辑进 core，外壳只做展示和宿主 API 适配**。加新形态（浏览器插件）时不要复制业务逻辑。

## 数据源一览

| 品种 | 来源 | 频率 | 口径注意 |
|---|---|---|---|
| 浙商/民生/工商/广发/兴业/中信 | 京东金融批量接口 | 实时（秒级） | 自带涨跌幅；部分银行只给单边价，点差显示 0 |
| 建行账户金 Au99.99 / Au99.95 | 建行公开 XML | 实时 | 不给昨收，涨跌幅由本地当日首笔推算 |
| 建行积存金当日价 | 同上 feed 的 code 23 | 买入价每日 10:30 定价，赎回价盘中更新 | 点差是「日定价 + 实时赎回价」的混合值，别当对称买卖价差 |

接口细节、字段含义与已证伪的源见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。

## 关键约定

- **提醒是穿越触发**：只在条件由假变真时提醒一次，价格长期停在同一侧不会重复弹；首次取数只记基线不报警。
- **提醒不限品种**：面板设置页每行都能选银行和方向（涨到 / 跌到 / 当日 ±%），可 `＋ 新增提醒` 也可 `×` 删除。id 固定是 `品种-方向`（`compileRules` / `ruleIdOf`），所以面板里设的 `ZS-below` 与 VS Code「设置到价提醒」写出来的是同一条，两端互通；同品种同方向重复的行只保留第一条，阈值留空的行不保存。
- **健康三态**：`ok / degraded / offline`，只在**状态变化**时告警。取数成功但报价长时间不更新同样判异常。连续 3 轮全部失效后自动降频（2 的幂、封顶 300 秒，`core/backoff.ts`），恢复立刻回到设定值；面板与 VS Code tooltip 会说明当前为什么变慢。
- **休市不算故障**：`core/market.ts` 按北京时间判断连续盘（09:00 → 次日 02:30），周末、法定节假日、节前停夜盘都先当休市。休市期间报价冻结不判陈旧，面板徽标显示灰色「休市」并悬停给出原因，托盘 tooltip 与 VS Code tooltip 同样说明。节假日表来自上金所 2026 年休市公告，`MARKET_SCHEDULE_AS_OF` 跨年前必须重新核对。
- **点差 0 不等于免费**：上游只给单边价时 `buyPrice == sellPrice`，面板的「点差」列会自动退回服务费口径显示，悬停看具体说明。
- **费率是静态表**：接口不返回费率，`fees.ts` 里每条都带 `asOf` 日期，改动时务必更新日期。核实超过 90 天（`FEE_STALE_DAYS`）会在点差列标黄带 ⚠ 提示重新核对；只显示 `—` 的品种不标。
- **不要跨银行比较涨跌幅**：各家"昨收"定义不同，同一时刻可能一个显示跌、一个显示涨。
- **点击语义全形态统一**：左键=详情、右键=设置。托盘、悬浮球、任务栏文字都遵守；托盘原来的右键菜单已并入面板设置页（含退出）。VS Code 状态栏无法区分左右键，因此是「价格项左键=详情」+ 旁边一个 `$(gear)` 项=设置。
- **显示内容由 core 判定**：`settings.display = { name, up, down }`，三个形态都调 `core/format.ts` 的 `priceTone`（颜色）与 `showArrow`（箭头），不在各自外壳里决定显示什么。设置页把它收成「品种名称」勾选 + 「涨跌箭头」下拉框（`arrowModeOf` / `displayFromArrowMode` 负责与两个布尔互转）。关掉某方向**只隐藏该方向的箭头**，价格颜色仍按真实涨跌（涨红跌绿）；持平或涨跌幅缺失才是白色。
- **悬浮球大小等比例**：`settings.ball.scale`（0.6–1.8）同时决定窗口尺寸与 `zoomFactor`，缩放围绕球心；区间与算法在 core（`clampBallScale` / `ballSizeFor` / `scaledSquare`），滑杆不自己写死。
- **开机自启默认关**：面板设置页的开关走 `app.setLoginItemSettings`，只在打包后的 win32/macOS 出现（开发态注册进去的会是 Electron 本体）。portable 版用 `PORTABLE_EXECUTABLE_FILE` 的原始 exe 路径注册；开关状态回读系统真实值。
- **面板的单元格文本也来自 core**：主进程用 `formatQuoteCells` / `spreadCell` 生成 `cells`、`spreadCells` 下发，`panel.js` 只贴字符串，不允许出现 `toFixed`。品种顺序同理，走 `applySymbolOrder`（`settings.symbolOrder`），没排过的新品种追加在末尾。
- **面板分时图只读本地采样**：`core/trend.ts` 按北京时间自然日分桶，超过 30 分钟的空档断开不连线，1 秒档降采样到最多 240 点再画；设置页可关闭图表，或把范围切到 1 小时 / 半天 / 全天（默认全天）。1 小时/半天从区间末笔往回截且不跨出自然日，涨跌与高低只看窗口内采样；休市或当日不足两个不同时间戳时自动回退到最近有效交易日，标题标明日期。曲线只覆盖 App 运行期间的采样，不是交易所完整分时。
- **面板弹在点它的入口旁边**：`showPanel(mode, source)` 带上入口（托盘 / 悬浮球 / 任务栏文字），位置取该窗口 bounds 再夹进工作区。Windows 的 `tray.getBounds()` 经常给整条任务栏，拿不到图标时依次退回任务栏文字、悬浮球。

## 常见坑

1. **改了代码忘了重新 bundle**：菜单栏的 `main` 指向 `dist/main.cjs`，必须 `npm run menubar`（或 `menubar:dist`）而不是直接 `electron .`，否则跑的是旧代码。出包后可用 `grep 关键字 release/mac-arm64/GoldSentry.app/Contents/Resources/app.asar` 校验内容。
2. **pnpm 10 默认不跑依赖的构建脚本**：所以仓库根 `postinstall` 会显式补装 Electron 二进制（`scripts/ensure-electron.cjs`，走镜像下载约 100MB）。若该步骤失败，手动执行 `node scripts/ensure-electron.cjs` 重试。
3. **国内网络**：`.npmrc` 已配 Electron 镜像；`electron-builder` 的 dmg 工具链要另设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`，否则会卡在 GitHub CDN。
4. **arm64 未签名应用**：`identity: null` 出的包能启动，但系统通知可能被静默丢弃——所以推送主通道走 Bark，不依赖原生通知。
5. **`--host-resolver-rules` 对主进程无效**：Electron 主进程的全局 `fetch` 走 Node undici，不是 Chromium 网络栈；要模拟断网请用 `NODE_USE_ENV_PROXY=1` + 死代理。
6. **不要用裸 `import.meta.dirname` 处理打包路径**：bundle 成 CJS 后用 `__dirname`。
7. **Windows 未签名产物被 Smart App Control 拦**：本机 `VerifiedAndReputablePolicyState=1`，安装版与 `win-unpacked` 的 exe 实测启动即 `Permission denied`（退出码 126），CodeIntegrity 事件 3033/3077，策略 ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`；早前 portable 曾启动过、同内容重建后就被拒，符合该系统按文件信誉判定的特征。这不是构建问题，火绒只与早期 NSIS 阶段有关。要让安装版能启动，只能由用户关闭 Smart App Control（系统级、不可直接逆）或使用代码签名证书；仅做 CDP 验证时可让本机 Electron 加载 `resources/app.asar`，但不要把它当日常启动方式。

## 验收清单

- [ ] `npm run probe` 能打印 9 条报价，无错误
- [ ] `npm run verify:all` 全绿（含展示格式与任务栏几何）
- [ ] 菜单栏显示中文短名、涨跌红绿、点差列（有点差显示点差，否则服务费）、刷新间隔下拉可切换
- [ ] 点任意一行，菜单栏 / 任务栏文字 / 悬浮球数字随之切换
- [ ] 长按面板某行拖动排序，重开面板仍是那个顺序；新接的银行不会被顺序表漏掉
- [ ] 面板出现在真正点开的入口旁边：托盘图标 / 悬浮球 / 任务栏文字各试一次
- [ ] 到价提醒：换一个银行、加一条、删一条，保存后 `rules.json` 与面板回填一致；重启 VS Code 扩展看同一条规则也在
- [ ] 设置页「涨跌箭头」下拉框四种模式来回切，价格颜色始终按真实涨跌（只有持平才白）
- [ ] 详情页按住约 0.26 秒后拖动可排序（按下立刻移动也要能拖），重开面板仍是那个顺序
- [ ] 悬浮球「大小」滑杆从 60% 到 180% 等比缩放，缩放时球心不动，放大后拖动不脱节
- [ ] Windows：任务栏文字贴在托盘左侧、两位小数、可拖动；悬浮球可拖动、滚轮调透明度
- [ ] Windows：全屏看视频时任务栏文字约 1 秒内自动隐藏，退出全屏后自动回来；悬浮球保持显示
- [ ] 面板详情页顶部显示主显品种分时曲线，悬停出现「时间 · 价格」；设置页可关闭图表，范围 1 小时/半天/全天切换后横轴与涨跌随之变化，重启仍保持；周末/节假日自动展示最近一个有数据的交易日（标题带日期），没有采样时显示"该区间暂无采样"
- [ ] 所有端的金额都是两位小数（含缺失时显示 `—`）
- [ ] 面板填 Bark key → 测试推送 → 手机收到
- [ ] 断网（`NODE_USE_ENV_PROXY=1 http_proxy=http://127.0.0.1:9`）时托盘出现 `×`，恢复后出现"已恢复"提醒；连续失效 3 轮后面板说明已降频，恢复后间隔回到设定值
- [ ] 周末或节假日打开：面板徽标是灰色「休市」（悬停有原因），更新列不标黄、不弹故障提醒；工作日 09:00 后自动回到「正常」
- [ ] 打包版（SAC 放行后）拨一次「开机自启」，重启系统确认 GoldSentry 自己起来；再关掉确认不再自启
- [ ] 把 `fees.ts` 某条 `asOf` 临时改到 100 天前，点差列标黄带 ⚠、悬停写明天数；改回后恢复灰色

## 文档

- [变更记录](docs/CHANGELOG.md)
- [路线图与待办](docs/ROADMAP.md)
- [数据源细节](docs/DATA-SOURCES.md)
- [给 AI 助手的项目说明](AGENTS.md)
