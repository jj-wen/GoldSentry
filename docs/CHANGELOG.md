# 变更记录

按日期倒序。记录"做了什么、为什么、验证到了什么程度"，细节取舍见 `ROADMAP.md` 与 `DATA-SOURCES.md`。

## 2026-11-09

### 新增

- **开机自启在 Mac/Windows 双端可用**：设置页在 win32/macOS 都会显示开关，打包后启用；开发态显示但禁用并说明原因。macOS 如果从 dmg 挂载目录运行会提示先拖进「应用程序」，避免把登录项注册到只读挂载点。Windows 安装版注册安装后的 exe，portable 版注册 `PORTABLE_EXECUTABLE_FILE` 原始路径；开关状态回读系统真实值。
- **安装与使用文档**：README 新增功能列表、macOS（arm64/x64）与 Windows（安装版/便携版）下载安装步骤、未签名应用的首次放行方式、开机自启位置、详情悬浮与基础操作说明；打包脚本改为同时出 Mac arm64 + x64，并给 dmg/portable 显式命名避免同目录覆盖。
- **面板行悬浮详情 + 各银行交易时段**：鼠标停在详情表格任意一行，弹出该银行的完整名称、买/卖价、实时点差、服务费、当日涨跌、报价时间、数据源，以及该行自己的交易时段和当前状态（开市中/已收盘/休市）。交易时段下沉到 `core/market.ts` 的 `tradingHoursOf` / `bankSessionAt`：工商 22:30 收盘，浙商次日 02:30，民生/广发/兴业/中信次日 02:00；周末与法定节假日休市，节前最后交易日晚上停夜盘。轮询重建表格时会按当前悬浮品种把卡片接上，不会每 10 秒闪断。验证：`verify:display` 新增 12 条时段断言；用本地 DOM 桩实测三行 hover 文案与 330×182 卡片位置，并模拟一次 `gold:update` 确认卡片不断开。
- **VS Code hover 改为一家银行一段**：原来的宽 Markdown 表格在窄 hover 里会挤成一团，现在每家银行用独立段落换行显示「银行全名、买入/卖出/点差、涨跌/费用/更新时间、交易时段与当前状态」，底部统一说明交易规则。验证：`verify:vscode` 新增「不挤成表格」「带交易时段与开市状态」两条断言。
- **Mac 菜单栏：文字反色 + 末尾一个彩色三角**：`tray.setTitle` 只支持字体类型，标题是系统单色的；Electron 也没法把托盘图标放到标题后面（图片固定排在文字左边）。要同时满足「文字颜色可指定」和「涨跌符号在最后、只出现一次」，只能把整条「健康标记 + 名称 + 价格 + 三角」画成 2 倍分辨率 PNG 当托盘图标（`apps/menubar/src/status-renderer.ts`）、标题清空。按用户要求文字颜色**与系统反着来**：浅色模式白字、深色模式黑字（600 字重），三角用红 `#ef5350` / 绿 `#26a269` 画在文字末尾。`nativeTheme` 变化时重绘；显示哪些片段仍由 core 的 `showArrow` / `priceTone` 决定。渲染失败自动退回系统标题 + 左侧彩色三角。实测浅色模式下导出图为白字「浙商 886.09」+ 末尾红三角、95×22，叠在金色底上可读；注入下跌后变绿 ▼，宽度不变。
- **Mac 菜单栏标题吃显示开关**：名称、上涨/下降开关与悬浮球/任务栏文字吃同一套 `readout()`，改设置立即刷新；macOS 的箭头由图标表达，标题不再重复。

### 修复

- **交易时段复核修正**：按京东 `goldPriceQuoteTimePeriodList` + 本地 10 天采样重新核对，修正工商/民生开盘为 09:10（不是 09:00），浙商展示为「周一 09:00–周六 02:30」；广发实测午后连续、夜盘到次日 02:00，不采用京东页面里的 15:30–20:00 空档。`bankSessionAt` 改为按「今天/昨天是否为交易日 + 开盘/收盘点」判断，凌晨夜盘归前一交易日；新增 09:05 未开盘、广发午后连续等断言。

### 变更

- **全套图标重做**：旧 `icon.png` 的 PNG 行宽编码损坏（Chromium 解码为空），换成本机脚本生成的 1024px 主图标（深色圆角底 + 金条 + 向上箭头）。Windows 托盘改用 64px「深色圆角底 + 金箭头」（金条细节在 16px 下糊成一团）；macOS 菜单栏模板改为圆角框 + 箭头，并按 1x/2x 两个分辨率显式加载。验证：解包 dmgs 的 `.icns` 与 Windows exe 内嵌 PNG 均确认是新图，asar 内 `tray-glyph.png` 存在。
- **刷新间隔收口为 5 秒–10 分钟**：下拉框改为 5 秒 / 10 秒 / 30 秒 / 1 分钟 / 2 分钟 / 5 分钟 / 10 分钟，去掉 1/2/3/8 秒，新增 10 分钟档；`ALLOWED_INTERVALS` 同步校验。修掉降频逻辑的边界：用户选 10 分钟时，连续失效不会再被 300 秒上限"降频"成 5 分钟，`backoffSeconds` 保证结果不小于用户设定值。验证：`verify:health` 新增 10 分钟档不回退断言。
- **分时图最高/最低值改白色**：详情页图表右上的「低 xxx · 高 xxx」原来用灰色 `#7d7f86`，对比度偏低；按用户要求改成纯白，字号与等宽数字不变。
- **中信费率与京东默认顺序**：中信积存金按用户核实改记点差 2.7 元/克（`asOf 2026-11-09`）；京东批量接口返回顺序不固定，且纯数字对象键会被 JS 按数值升序枚举导致民生（`21001001000001`）永远排最后，改为显式 `SKU_ORDER` 输出，默认顺序固定为浙商、民生、工商、广发、兴业、中信。验证：`verify:display` 新增乱序回填断言 + `npm run probe` 实测民生第二位。
- **状态栏涨跌幅百分比开关**：`settings.display` 新增 `pct`（默认关）。打开后菜单栏（位图标题）、Windows 悬浮球/任务栏文字、VS Code 状态栏都在价格后追加 `formatPct`（如 `+1.50%`）；没有涨跌幅就整段不显示，不会出现 `—`。顺序统一为「名称 价格 ▲ 百分比」：价格 14px（比名称大一号）、百分比 12px（小一号）、名称 13px。面板设置页加「涨跌百分比」勾选，VS Code 加 `goldsentry.showPct` 配置与设置项。实测菜单栏 strip 146×22，内容「浙商 885.60 ▲ +1.50%」。`normalizeDisplay` 增加布尔校验与默认值断言。
- **费率表按银行对比表更新**（用户提供，数据更新至 2026.8）：工商由"0 手续费"改为买入 0.2% / 卖出 0.5%；民生按用户核实取实际点差 3.8 元/克（对比表列买入 0 / 卖出 0.4%）；兴业 3.8 元/克、建行积存金 4–6 元/克、江苏 2.8 元/克起。`FeeInfo` 新增 `spread`（元/克）与 `spreadText`（区间）两个字段：上游点差为 0 或负时，点差列直接显示人工核实的 `3.80元` / `4–6元`，带"元"与百分比费率区分；没有数字的广发/中信仍显示 `—`。核实日期统一写进 `asOf`，超过 90 天照旧标 ⚠。

### 修复

- **Mac 详情面板没贴在菜单栏价格下方**：`iconRect()` 用 64px 上限判断"这是不是托盘图标"，但 macOS 带标题的状态项 `getBounds()` 返回的是图标+文字整块宽度（实测 ` 881.45` 已是 66px），超限后被当成脏数据丢弃，面板退回工作区右下角。改为按平台给上限（macOS 360px / Windows 64px），顶部锚点直接贴菜单栏下沿、不再留 6px 缝，并仍按工作区夹取避免溢出屏幕右缘。实测状态项 105×30 时面板紧贴菜单栏下沿（y=30）并在状态项下方居中，靠右时自动左移。

## 2026-11-08

### 新增

- **费率过期提醒**（`core/fees.ts` 的 `feeCell` / `feeAgeDays` / `FEE_STALE_DAYS=90`）：人工核实的费率超过 90 天，面板点差列标黄并带 ⚠，tooltip 写明"已 N 天未核对，请以银行 App 为准"；VS Code tooltip 与 QuickPick 详情同步带 ⚠。只有真的显示出费率数字才标——本来就查不到数字（显示 `—`）的品种再标黄只是噪音。点差口径不受影响。
- **连续失效自动降频**（`core/backoff.ts` + `QuoteStore.failureStreak`）：连续 3 轮"全部失效"后间隔按 2 的幂拉长（30 秒档 → 60/120/240，封顶 300 秒），恢复或转为部分异常立刻归零回到设定值。失效次数落盘，重启接着算。面板在刷新间隔下方说明"已连续失效 N 次，暂时降频到 X 秒"；VS Code tooltip 同样标注。两端定时器从 `setInterval` 改成每轮重排的 `setTimeout` 链。
- **开机自启开关**（面板设置页，`app.setLoginItemSettings`）：默认关；只在打包后的 win32/macOS 提供，开发态隐藏（否则注册进系统的是 Electron 本体）。portable 版用 `PORTABLE_EXECUTABLE_FILE` 里的原始 exe 路径注册，避免注册到每次运行都变化的临时解压目录。开关状态回读系统真实值，用户在任务管理器里自己关掉后面板不会谎报。
- **面板分时折线**（`core/trend.ts` + `QuoteStore.trend()` + 面板详情页）：主显品种在详情页顶部显示当日分时曲线，涨红跌绿、面积填充，悬停显示「时间 · 价格」；横轴按北京时间自然日 00:00–24:00，午休/收盘超过 30 分钟自动断线，不把空档连成斜线。数据直接复用 `QuoteStore` 已有的 10 天采样，不新增取数；1 秒档一天上万个点先降采样到 240 个再画。金额与涨跌文案全部由 core 格式化，面板不自己 `toFixed`。休市时自动回退到最近一个「至少有两个不同时间戳」的自然日（只有重复时间戳的测试残留不算），标题标明日期。
- **分时图配置**（`settings.trend` + 面板设置页）：新增「显示分时图」开关与「时间范围」下拉（30 分钟 / 1 小时 / 2 小时 / 4 小时 / 6 小时 / 半天 / 全天），默认显示、全天。配置归一化在 `core/trend.ts` 的 `normalizeTrendSettings`，脏值退回默认；非全天范围按所选区间末笔往回截，不跨出自然日，涨跌与高低也只看窗口内采样；休市回退历史日时以当天最后一笔为窗口末端。横轴刻度与悬停时间由 core 生成，面板不再自己拼时间。
- **Windows 任务栏迷你走势**（`settings.taskbar.trend` + `core/trend.ts` 的 `trendSparkline`）：任务栏文字右侧可显示一条 42×12 的极简折线，颜色跟随所选时间范围的涨跌。core 负责把点按时间比例与高低价归一化到 0–1 并保留断档标记，任务栏外壳只按像素缩放，不参与取数与方向判定。与面板分时图**分开开关**：关掉面板图表仍可保留任务栏走势；竖排任务栏空间不足时自动隐藏。任务栏窗口宽度随折线点数量与开关重新测量。
- **交易时段与休市健康态**（`core/market.ts`）：按北京时间识别银行积存金的连续盘——日盘 09:00–15:30 直接接夜盘到次日凌晨，取各家收盘并集 09:00 → 次日 02:30；周末、法定节假日、节前停夜盘（如国庆前 9/30 晚）判为休市，节日最后一天凌晨也归休市。`HealthReport` 新增 `marketClosed` / `closedReason`，休市期间跳过"成功但报价陈旧"判定，因此不会再误报"部分异常 / 全部失效"。面板徽标改为灰色「休市」（悬停显示原因），托盘与 VS Code tooltip 同样解释；更新列在休市时不再标黄。节假日表来自上金所 2026 年休市公告，`MARKET_SCHEDULE_AS_OF` 标注核对日期，跨年前必须复核。

### 修复

- **点"刷新"后渲染层抛异常**：`gold:refresh` 返回 `poll()` 的 `void`，面板 `.then(applyState)` 拿到 `undefined` 后读 `next.lastPollAt` 抛错。改为等轮询结束返回完整 `state`。
- **`hidden` 属性被 `display:flex` 盖掉**：`.ball-row { display:flex }` 优先级高于 UA 的 `[hidden] { display:none }`，导致开发态本该隐藏的"开机自启"行仍然显示（DOM 的 `.hidden === true` 但肉眼可见）。补全局 `[hidden] { display:none !important }`，并删掉原来只补兄弟节点的那条 `.ball-row[hidden] + .hint` 补丁。
- **任务栏迷你走势"写了但看不见"**：SVG 元素没有 `hidden` 这个 IDL 属性，`svg.hidden = false` 只挂了一个扩展属性，HTML 上的 `hidden` 内容属性仍在；同时 UA 的 `[hidden]` 规则也管不到 SVG，导致折线要么不显示、要么关掉后仍占 42px。改成 `toggleAttribute('hidden', ...)`，并在 `taskbar.css` 显式写 `.spark[hidden] { display:none }`。
- **VS Code 暂停后永远不再轮询**：暂停时 `clearInterval` 清掉了定时器，恢复时只刷新一次却没有重建定时器。改成 `setTimeout` 链后暂停只跳过取数、链保持活着。
- **全屏应用下不再把价格压在视频上**（`core/taskbar.ts` 的 `coversTaskbar` + `apps/menubar/src/fullscreen.ts`）：Windows 上看全屏视频时任务栏会藏起来，但 `display.workArea` 不变，原来的几何贴附仍把任务栏文字留在屏幕上。现在常驻一个 PowerShell 探针（1 秒一轮、只在结果变化时输出），枚举可见且有标题的顶层窗口，把「窗口矩形≈所在显示器矩形」的显示器收集为全屏集合；只有全屏显示器真的盖住任务栏贴纸那一块时才隐藏文字窗口——双屏时副屏全屏不影响主屏贴纸。悬浮球保持显示。探针随「显示任务栏文字」开关启停，退出应用时杀掉，并每秒检查主进程是否还在（避免强杀后留下孤儿进程）。
- **退出全屏后文字不恢复**：首版探针漏掉了 DWM 已隐藏（`DWMWA_CLOAKED`）的窗口和桌面窗口——本机 `TextInputHost` 的「Windows 默认锁屏界面」`IsWindowVisible=true` 且矩形正好是 1920×1080，`Program Manager` 也会命中，导致全屏集合永远非空、永远等不到「全屏结束」。现在同时按 `DwmGetWindowAttribute(hwnd, 14)` 和壳类名（`Progman` / `WorkerW` / `Shell_TrayWnd` / `Shell_SecondaryTrayWnd`）过滤。

### 验证

- `npm run verify:all` 248 条断言全绿（新增交易时段/更新列 25 条、休市健康态 7 条、`coversTaskbar` 5 条、分时序列/配置/迷你走势 39 条；`verify:health` 的既有断言已固定到周五 10:00，避免周末跑测试误判）；`npm run probe` 九条报价无错误。
- 真机 CDP（2026-11-08 周日）：面板徽标显示灰色「休市」且悬停为"周末休市"，更新列保持灰色不标黄，错误条不出现，健康状态为 `ok` 而不是 `degraded`。把时间拨到工作日 09:00 的恢复路径由 `verify:health` 断言覆盖。
- 真机验证全屏隐藏（Chrome 在 1920×1080 主屏全屏）：启动日志出现 `[fullscreen] 全屏覆盖 1 块显示器`，CDP 里 `taskbar.html` 的 `document.visibilityState` 为 `hidden`，悬浮球仍是 `visible`；在副屏再开一个无边框全屏探针窗口，日志变为「2 块显示器」，关闭后回到「1 块显示器」，按显示器粒度判定与变更去重都符合预期。
- 真机验证恢复路径的判定条件：用户反馈「退出全屏后文字不回来」，复现到退出全屏瞬间 Chrome 已是 1920×1032，但旧探针仍把隐藏的「Windows 默认锁屏界面」和 `Program Manager` 当成全屏，因而始终输出 1 块显示器。修正后用同一套条件做受控枚举（临时忽略 Chrome 进程），全屏集合为空。
- 真机验证完整隐藏/恢复链路（修正后的构建）：用无边框测试窗口盖住主屏 8 秒，逐 0.5 秒枚举贴纸窗口——全屏期间任务栏文字窗口 `IsWindowVisible=false`、悬浮球仍可见；窗口关闭后约 1 秒内文字窗口恢复 `IsWindowVisible=true`，日志依次出现「全屏覆盖 1 块显示器」→「全屏结束」。
- 真机 CDP 验证面板分时图（2026-11-08 周日休市）：主显浙商自动回退到最近有效交易日 11-06，240 个降采样点、低 865.39 / 高 875.55、涨跌 +0.02% 与曲线一致；悬停显示「13:12 · 878.08」，十字线与圆点跟随。另用 600 点合成数据验证夜盘→早盘的断线、面积填充与重复时间戳去重；测试后 `settings.json` / `rules.json` / `quotes.json` 均已逐字节还原。
- 真机 CDP 验证分时图配置：设置页新增开关与范围下拉；切到 1 小时标题变「11-06 · 1 小时」、横轴 22:07–23:07、涨跌 +0.20%，切到半天横轴 11:07–17:07–23:07、涨跌 +0.02%，切到 30 分钟横轴 22:37–22:52–23:07、涨跌 +0.21%，全天恢复 00:00–12:00–24:00；关闭后图表 `display:none`，范围下拉保持可用（任务栏走势共用同一范围）。设置为「显示 + 1 小时」重启后回填一致；测试后三份运行时文件逐字节还原。
- 真机 CDP 验证任务栏迷你走势（2026-11-08 周日休市，回退 11-06）：勾选后任务栏窗口由 85px 增到 132px，`#spark` 出现 1 条 `polyline`，标题为「全天 +0.02%」；切 1 小时/半天/30 分钟分别显示对应范围与涨跌，折线横坐标随时长变化；取消勾选后窗口收回 85px、`#spark` 为 `display:none`；关掉面板分时图后任务栏折线仍在。竖排布局下 `#spark` 自动 `display:none`。截图见面板设置页与任务栏局部（红涨折线在价格右侧）。测试后 `settings.json` / `rules.json` / `quotes.json` 已还原。
- 真机 CDP：把代理指向死端口模拟断网，实测 streak 3→60 秒、1 秒档 streak 5→8 秒，面板降频提示文案与秒数一致；恢复联网后 streak 归零、间隔回到设定值、提示隐藏。注入过期单元格实测标黄 `rgb(216,162,74)` 且正常点差仍是灰色。
- **开机自启的打包路径仍未实测**：本机 Smart App Control 仍拦未签名 exe（策略值 `0x1`），开发态只能验证"开关隐藏、不谎报"。装好签名或关掉 SAC 后需要真机拨一次开关并重启确认。

## 2026-11-06

### 新增

- **数据源失效检测**（`core/health.ts`）：三态 `ok / degraded / offline`。除取数报错外，还能识别"HTTP 200 但报价冻结"——实时源超 5 分钟、日定价源超 20 小时未更新即判陈旧。状态**只在变化时**告警：首轮只记基线，降级报一次、恢复报一次，持续同一故障不重复。
- **托盘故障标记**：`!` 表示部分异常、`×` 表示全部失效，tooltip 附原因；面板顶部加红黄绿健康徽标。
- **Bark 推送**（`core/notify.ts`）：`POST /push` + JSON，device key 放在请求体而不是 URL 路径，避免泄漏到访问日志；403/400/410 映射为可读中文；错误信息不含 key 与请求体。推送失败会回显到面板错误条。
- **VS Code 端接入 Bark**（配置项 `goldsentry.barkKey` / `barkServer`）。
- **中文品种短名**：`Quote.label`（浙商/民生/工商/广发/兴业/中信/账户金/账户金95/建行日价），映射放在数据源里，避免各端各自维护翻译表。
- **涨跌幅列**：红涨绿跌（A 股习惯）。京东六家用接口自带的相对昨收值；建行 feed 不给昨收，在 `poller` 里用本地当日首笔补齐，因此所有端都能显示。
- **费用列**：京东接口无费率字段（五个产品 DTO 全键名已核），改用带 `asOf` 的人工核实表（`core/fees.ts`），查不到的显示 `—`。
- **刷新间隔可选**：1/2/3/5/8/10/30 秒、1/2/5 分钟，落盘 `settings.json`，切换后立即重建定时器。默认 30 秒。

### 修复

- **打包产物启动即崩**：`state` 初始化引用了后声明的 `DEFAULT_SETTINGS`（TDZ），报 `App threw an error during load`。只有真正运行打包产物才会暴露。
- **dmg 里是旧代码**：上一轮直接调 `electron-builder` 跳过了 `build:code`，导致打包进 asar 的仍是改中文名之前的 bundle（用户看到英文简写）。现在只用 `dist` 脚本，并有 asar 内容 grep 校验。
- **托盘显示了最滞后的价**：原先硬编码优先 `JJC`（建行 10:30 日定价），主源换成京东后仍显示旧值。改为可配置主显品种，取不到则退回最新一条实时价。
- **涨跌幅解析成 NaN**：`upAndDownRate` 形如 `+1.86%`，`Number()` 直接转会得到 NaN。改为剥离正负号与百分号，非法值返回 `undefined` 以走本地兜底。
- **`settings` 与默认值共享引用**：`let settings = DEFAULT_SETTINGS` 会让后续修改污染默认值，改为浅拷贝。

### 工程化

- 目录整理：`probe.ts` 从 `packages/core/src/` 移到 `scripts/`，与三套 verify 脚本职责一致；根 `package.json` 增加 `engines.node`、`verify:all`、`menubar:dist`。
- 新增交接文档：`README.md`、`AGENTS.md`、`docs/CHANGELOG.md`、`docs/ROADMAP.md`、`docs/DATA-SOURCES.md`。
- 初始化 git 仓库并推送到 GitHub，36 个文件，已确认不含密钥与构建产物。
- 修复新机器首跑隐患：新增 `scripts/ensure-electron.cjs` 并由根 `postinstall` 调用，避免 Electron 二进制拖到首次运行时才下载而在受限网络下失败。

### Windows 支持

- **托盘 Windows 产物**：`menubar:dist:win`（`apps/menubar` 的 `dist:win`），win target 为 `nsis` + `portable`，`win-unpacked` 与 `GoldSentry 0.0.1.exe` 已产出。业务逻辑未动，外壳复用 `packages/core`。
- **托盘面板方向**：Windows 任务栏在屏幕下缘，面板原先一律往下弹会跑出工作区。`positionPanel` 按 `tray.getBounds()` 落在工作区下半部时改为向上弹，并用 `screen.getDisplayMatching` 适配多显示器。
- **托盘图标分平台**：macOS 继续用 `iconTemplate` 纯白剪影（菜单栏自适应深浅色），其他平台改用彩色 `assets/icon.png` 缩到 16×16，避免浅色任务栏上看不见。
- `.npmrc` 补 `electron_builder_binaries_mirror`（原先只有 `electron_mirror`，NSIS/7zip/winCodeSign 工具链会去 GitHub CDN 拉）。
- `vscode:install` 从 `rm -rf/mkdir -p/cp -r` 换成跨平台的 `scripts/install-vscode.cjs`（`os.homedir()` 定位 + `fs.cpSync`，缺 bundle 时直接报错而不是静默装错）。
- **VS Code 扩展在 Windows 实测通过**（VS Code 1.145.1）：按 `onStartupFinished` 正常激活、无加载错误；`globalStorage` 里的 `quotes.json` 随轮询持续增长（35 秒新增 27 条样本），`healthStatus=ok`，六家实时源时间戳滞后 3~8 秒，账户金约 99 秒、建行日定价停在 10:30——后两者是上游自带时间戳，属预期。**只有状态栏的实际显示仍需肉眼确认。**

### 变更

- **VS Code 状态栏左键改为全量对比**：原先左键 = 选品种、对比表只在悬停 tooltip 里。现在左键绑新命令 `goldsentry.show`，弹 QuickPick——一行一家，标题是「短名 + 买入价」，右侧「卖 x · 点差 y · 涨跌 z」，详情行「费用 · 上游报价时间 · 口径」，当前主显品种带 `$(star-full)` 标记且排在实时源首位、建行日价固定排最后。回车即把该行品种设为状态栏显示品种，因此原 `goldsentry.pick` 能力被这个入口覆盖，但命令与菜单项都保留（旧路径不动）。tooltip 末尾提示语随之改为「点击状态栏看完整对比，选中一行即切换显示品种」。
- `verify-vscode` 从"只打印不断言"补成 11 条 `PASS/FAIL` 断言：命令注册与左键绑定、新旧入口共存、列表条数、每行字段格式、日价排序、回车写配置、Esc 不改配置；`npm run verify:all` 现共 75 条断言。

### Windows 常驻显示（任务栏文字 + 悬浮球）

- **金额统一两位小数**：新增 `core/format.ts` 的 `formatPrice` / `formatPct`，托盘 title、面板、悬浮球、任务栏文字、提醒文案、VS Code 状态栏与 QuickPick 全部改走它；`verify:display` 覆盖补零、四舍五入、缺失值显示 `—`。托盘原先的 `toFixed(1)` 是唯一漏网处。
- **任务栏文字**（Windows 专属，模仿 TrafficMonitor）：Electron 没有嵌入系统任务栏的接口，改为无边框透明置顶窗口贴附在任务栏上，显示「品种短名 + 两位小数买入价 + 涨跌箭头」。默认在托盘左侧留 300px，可沿任务栏拖动并记住位置；支持上/下/左/右四边任务栏、自动隐藏时隐藏、分辨率与显示器变化后重排、单击开合面板。几何计算下沉到 `core/taskbar.ts`（`detectTaskbar` / `placeOnTaskbar`）。
- **悬浮球**（Windows 专属）：104px 圆球显示主显品种，拖动移位并记忆、滚轮或面板滑杆调透明度（30%–100%）、单击开合面板；面板新增「任务栏文字」「悬浮球」两个开关，从面板关闭时同步重建托盘菜单的勾选状态。
- 两者共用 `readout()`，数据口径一致：主显品种优先，取不到退回最新一条实时价；健康异常时文字前加 `!` / `×`。
- 实测：CDP 驱动真实 Electron 窗口 25 条断言全过——1080p 下窗口 99×48 贴住任务栏底边（`y=1032`）、右端留 300、拖动 -120 只改 x、位置落盘、面板开关隐藏/恢复、切换主显文字跟随；`npm run verify:all` 74 条断言全绿（口径断言加入后为 75），`probe` 退出码 0。
- **打包态复测**：`win-unpacked` 与当轮 portable 各跑一遍 CDP，9 条断言全过——文字「浙商 867.77 ▼」/「浙商 868.08 ▼」、窗口 99×48、`y=1032`、右端 300px 安全区、未进入竖排；asar 内 `MIN_THICKNESS = 4` 与源码一致。注意页面刚创建时还没收到首轮行情，读取方要等 `data-ready` 再断言。
- **产物**（15:49 那轮，退出码 0）：`GoldSentry 0.0.1.exe`（portable，110MB）、`GoldSentry-Setup-0.0.1-x64.exe`（NSIS，121MB）；该轮 portable 启动后 CDP 9 条断言全过，测试后已还原 `settings.json`。
- **最终重建遇到系统策略拦截**（15:57 那轮，含口径提示）：构建与 asar 内容正常（`MIN_THICKNESS = 4`、面板提示原文都在），但新 exe 被 **Windows Smart App Control / Code Integrity** 拒绝执行——`VerifiedAndReputablePolicyState=1`，CodeIntegrity 事件 3033/3077，策略 ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`。此前误记为“联想火绒拦截、旧包能跑”；火绒只与早期 NSIS `spawn UNKNOWN` 有关。改用本机 Electron 加载最终 `app.asar` 完成验证：任务栏 8 条断言 + 面板 4 条（9 行报价、两处口径提示已渲染）全过。要让本机 exe 启动，需用户关闭 Smart App Control 或提供签名证书。
- **安装包实机安装**（16:20 左右，安装成功、启动被拦）：`GoldSentry-Setup-0.0.1-x64.exe /S` 静默安装退出码 0，装到 `%LOCALAPPDATA%\Programs\GoldSentry`，开始菜单快捷方式与卸载注册项均已生成；但安装版 `GoldSentry.exe` 启动仍报 `Permission denied`（退出码 126），同为 Smart App Control 拦截。当前改用本机 Electron 运行源码构建来查看任务栏文字；**安装版要真正能启动，需用户决定关闭 Smart App Control 或改用签名证书**。
- **仍需肉眼确认**：任务栏文字是否真的盖在系统任务栏之上（屏幕录制受限，CDP 只能确认窗口位置、尺寸与可见状态）、任务栏文字与悬浮球在当前主题下的对比度。
- 已知限制：Windows 任务栏自动隐藏时贴附文字会隐藏（Electron 拿不到"任务栏展开"事件）；独占全屏应用下覆盖窗口可能仍显示；拖动后允许压住托盘图标；真正 `SetParent` 进 `Shell_TrayWnd` 需要原生模块，超出本仓库"core 零第三方依赖"的约束，未做。

### 复核与口径

- **建行 `JJC` 确认为积存金当日价**：官方页面 `getGoldStore()` 明确「输入 01 查赎回价，输入 23 查积存价」，码为 23 时列名切为「当日积存价」；`zhgjs_new.xml` 的 23 今日滚动到 `Tms=10:30:00`，`MdlRate` 与实时金价一致。官网积存金页读的 `gjshjjc01.xml` 反而冻结在 2026-07-27。结论写进 `ccb.ts` 注释与 `DATA-SOURCES.md`，`ROADMAP.md` 的待复核项关闭。
- **口径修正**：23 的买入价每天 10:30 固定、赎回价盘中仍变，而 `Tms` 固定 10:30，所以点差是「日定价 + 实时赎回价」的混合值（今日 10:30 后 10.9~11.6 元，10:30 前 18~20 元），不是对称买卖点差，也不是取数错误。本地样本里同一 `Tms` 下 sell 变动多次可证。
- **涨跌幅口径提示**：面板对比表下方、VS Code tooltip 与 QuickPick 占位符都标注「涨跌幅口径以各行 App 为准，勿横向比较」；`verify-vscode` 增加 1 条 tooltip 文案断言，现 12 条，`verify:all` 共 75 条。

### 遗留（Windows + VS Code）

- 扩展标识符是 `goldsentry.@goldsentry/vscode`：`apps/vscode/package.json` 的 `name` 直接用了 workspace 的 scoped 名，斜杠会进 ID。本机加载不受影响，但 ID 含斜杠不合法、`globalStorage` 被拆成嵌套目录 `goldsentry.@goldsentry/vscode/`，且上架 Marketplace 会被拒。改名会牵动 `pnpm --filter @goldsentry/vscode`，需要先定方案。

### 修复

- **`verify:notify` 在 Windows 上把全绿跑报成失败**：脚本收尾的 `process.exit()` 会撞上 libuv 断言 `UV_HANDLE_CLOSING`（`src/win/async.c:76`，进程码 `0xC0000409`），11 条断言全过后仍以非 0 退出，连带 `verify:all` 整链断掉；失败路径更糟——直接崩，退出码毫无意义。改为 `process.exitCode = failures ? 1 : 0` 让事件循环自己排空，stub 的 `close()` 也改为等待 `server.close` 完成。
- 中途试过 `setTimeout(...).unref()`：不崩，但定时器压根不会触发，Node 以 0 退出，**会把失败断言吞成通过**。已回退，记录以免再踩。

### 发现（影响后续设计的结论）

- **NSIS 之前失败、现已能出包**：早前 `spawn UNKNOWN` 的原因是 NSIS 需先运行一次安装包生成卸载器，而本机安全软件（联想火绒 `usysdiag.exe`）当时拦了未签名的 Electron 产物——与后来的 Smart App Control 拦截是两回事。2026-11-06 15:45 复测同一台机器，`menubar:dist:win` 一次性产出 `GoldSentry 0.0.1.exe`（portable，110MB）与 `GoldSentry-Setup-0.0.1-x64.exe`（NSIS，121MB）且退出码 0。2026-11-06 16:20 安装包已实机静默安装成功，但安装版被 Smart App Control 拦（见上），交付仍以源码态/便携产物为主。
- 因此 Windows 产物的**托盘/任务栏 UI 尚未肉眼验收**：已验证到进程存活、`app.asar` 内含新代码，以及任务栏贴附窗口的几何/文字（CDP）。


- **取数与推送共用同一条网络出口**：本机断网时两者一起失效，客户端无法自报"整机失联"。这是本地轮询的结构性盲区，需要独立服务端的哨兵，见 ROADMAP。
- **各家"昨收"口径不一致**：同一时刻工商显示 `-1.40%`、其余 `-0.4x%`，因为工商昨收取上一日盘收盘（884），其他行像取今日凌晨夜盘收盘（876）。六家的涨跌幅不可横向比较。
- **部分银行只给单边价**：浙商/民生/工商/中信返回的买卖价相同，点差恒为 0，不代表免费。
- **建行积存金日价存在口径错位**：每日 10:30 前，买入价停在上一日定价、卖出价已跟随当日行情，会出现 18~20 元/克的虚假点差。

### 交互统一（左键详情 / 右键设置）与显示开关

- **统一点击语义**：托盘、悬浮球、任务栏文字一律**左键开详情、右键开设置**。为此移除了托盘右键菜单（`buildTrayMenu` / `refreshTrayMenu` / `Menu` 依赖），原菜单项全部并入面板设置页：刷新、测试系统通知、任务栏文字开关、悬浮球开关、Bark、退出。
- **面板分页**：`panel.html` 拆成「详情 / 设置」两个 tab，主进程通过 `panel:mode` 通知渲染层切页；同一侧再点一次收起，不同侧直接切页。设置页内容较长，面板改为内部滚动。
- **显示内容开关**：新增 `settings.display = { name, up, down }`，判定放在 `core/format.ts` 的 `showPct` / `normalizeDisplay`，三个形态共用同一份规则。关掉某个方向后该方向的涨跌幅**整条不显示**，而不是显示成平盘；平盘（0）归到上涨口径，因为 `formatPct(0)` 输出 `+0.00%`。
- **VS Code 的平台限制**：状态栏项只有一个 `command`，无法区分左右键。改为「价格项左键=详情」+ 新增第二个 `$(gear)` 项走 `goldsentry.settings`，用 QuickPick 提供显示开关、刷新间隔、主显品种、到价提醒、Bark key、暂停。
- **验证**：`verify:display` 新增 9 条显示开关断言（含脏配置退回默认、非布尔丢弃）；`verify-vscode` 修正了 `createStatusBarItem` 桩——原桩每次返回同一个对象，新增 ⚙ 项会把价格项的 `command` 覆盖掉，导致一条假失败；改为注册表并按优先级断言两项。
- **仍需肉眼确认**：Mac 上左键出详情、右键出设置是否真的生效（无法模拟鼠标点击）；Windows 上悬浮球/任务栏文字的右键是否被系统菜单抢占。

### Windows 面板四处改进（跟随入口、列宽、点差合并、长按排序）

- **面板跟着入口弹**：`showPanel(mode, source)` 记录入口来源，`positionPanel(source)` 用对应窗口的 bounds 定位——任务栏文字入口贴在它正上方，悬浮球入口贴在球上方。Windows 上 `tray.getBounds()` 不可靠（可能给出整条任务栏或空矩形），加了 `TRAY_ICON_MAX_WIDTH` 判定；拿不到图标位置时依次退回任务栏文字、悬浮球，最后才用工作区右下角。
- **点差与费用合并成一列**：`core/format.ts` 新增 `spreadCell(spread, symbol)`——点差 > 0 显示点差，点差为 0（上游只给单边价）退回服务费，两边都没有数字显示 `—`；tooltip 写明这格到底是点差还是费率（费率带 `asOf`）。面板表头从 7 列减到 6 列。
- **品种列不再换行**：单元格 `white-space: nowrap` + `table-layout: fixed`，面板宽度 420 → 440。实测 9 行行高一致（31px）、没有被裁掉的单元格、表格与页面都没有横向溢出。
- **长按拖拽排序**：`settings.symbolOrder` 落盘；`applySymbolOrder` / `normalizeSymbolOrder` 放在 core。面板长按 260ms 进入拖拽，拖动时直接改 DOM 顺序，松手提交 `gold:set-order`；拖拽期间跳过重渲染，否则轮询会把正在拖的那一行换掉。没排过的新品种追加在末尾，不会因为新银行上线而消失。
- **面板金额收回到 core**：`panel.js` 原先自己写 `toFixed(2)`（违反约定 7），现在由主进程下发 `cells`（`formatQuoteCells`）与 `spreadCells`（`spreadCell`），外壳只贴文本；`gold:fees` IPC 与 `getFees` 随之删除。
- **踩到的坑**：`gold:set-order` 一开始返回顺序数组，而面板用 `.then(applyState)` 把它当 state，`innerHTML = ''` 之后立刻抛异常 → 表格被清空。必须返回完整 `state`。另外合成指针事件没有真实 `pointerId`，`setPointerCapture` 抛错会打断后续 handler，做 CDP 自动化时要先空掉这两个方法。
- **顺带修掉的首屏错位**：`showPanel` 在面板刚创建时立刻发 `panel:mode`，页面还没加载完，消息被丢掉——**右键首次打开会停在详情页**，左键则因为默认就是详情而看不出问题。现在用 `panelReady` + `pendingMode` 在 `did-finish-load` 后补发。实测重启后第一次右键任务栏文字，设置页直接出现。
- **验证**：`verify:display` 新增 19 条断言（单元格字符串、点差/费率优先级、顺序清理与追加）；`npm run probe`、`npm run verify:all` 全绿。CDP 实测：任务栏入口面板落在 (1263,366)、悬浮球入口 (1472,98)（贴入口上方并夹进工作区），把第一行拖到第三行后落盘为 `["GS","GF","ZS",…]` 且行数仍是 9，清空顺序后下一轮轮询恢复默认顺序。
- **仍需肉眼确认**：点托盘图标时面板是否真的贴在图标上方（托盘点击无法程序化触发）；440px 的面板在你的屏幕上宽窄是否合适。

### 修复：任务栏文字拖一下整块看不见

- **现象**：把任务栏文字往左拖之后文字消失，但窗口还在（Win32 `IsWindowVisible=True`，位置 `925,1032`），`document.body.innerText` 仍在随轮询更新。
- **根因**：Windows 上 Chromium 用 DWM 遮挡计算判断窗口可见性。任务栏文字是 `focusable:false` 的置顶透明窗口，盖在任务栏上时会被判成"完全被遮挡"，`document.visibilityState` 变成 `hidden`，合成器停止绘制——透明窗口不绘制就等于整块透明。
- **做法**：仅 win32 在 `app.whenReady()` 之前 `appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`。
- **顺带修**：可拖范围以前只夹到 `rect.width - width`，拖到最右会压在系统时钟下面，看起来同样是"不见了"。现在 `placeOnTaskbar` 的夹取上限同样减 `TASKBAR_END_MARGIN`（1920 宽、99 宽的一条，最右只能到 1521）。
- **验证**：CDP 连续模拟 24 次 `move-by` 到左/中/右三个位置，`document.visibilityState` 全程 `visible`，截图文字都在；`verify:display` 新增 3 条边距断言（含竖排），全绿。位置已恢复到你之前确认的 `offset=1441`。

### 到价提醒不再锁死建行：面板可换品种、增删规则

- **背景**：core 的 `AlertRule` 本来就按 `symbol` 匹配任意品种，VS Code 的「设置到价提醒」也早已能从 9 个品种里选；只有 Windows 面板把 `rules.json` 里预置的 3 条（建行涨、建行跌、账户金 ±%）写死成"勾选 + 阈值"，所以看起来像只能提醒建行。
- **core**：新增 `compileRules` / `ruleIdOf` / `ruleKindOf` 与 `RULE_KIND_ORDER` / `RULE_KIND_TEXT` / `RULE_KIND_UNIT` / `RULE_COOLDOWN_MINUTES`。id 固定 `品种-方向`（swing 用 `-swing`，与预置的 `AU9999-swing` 对齐），因此面板与 VS Code 写出来的是同一条规则，两端共用一个文件。脏输入在 core 收口：阈值非正数或非数字直接丢整行，同品种同方向只留第一条，缺品种丢掉，非法方向退回「跌到」。
- **面板**：每行变成 勾选 + 品种下拉（9 个短名）+ 方向下拉（涨到 ≥ / 跌到 ≤ / 当日 ±%，单位占位符跟着换）+ 阈值 + `×` 删除，头部加「＋ 新增提醒」；保存走 `gold:save-rules`，返回完整 `state`。重绘改成按规则签名比对——落盘规则没变就不重建，避免轮询把正在编辑的行冲掉（实测刷新后未保存的行仍在）。
- **顺带修**：`panel.css` 里 body 宽度写死 440px，竖向滚动条一出现就把可视宽度压到 425，右侧文字被裁并冒出横向滚动条。改为宽度交给窗口，实测 `clientWidth === scrollWidth === 440`，溢出元素列表为空。
- **验证**：新增 `npm run verify:alerts`（22 条：id 约定、方向反推、脏输入、去重、上升沿/预热/冷却/关闭），并入 `verify:all`（现五套，128 条 PASS）。CDP 实测面板：9 个品种选项、方向选项与单位占位正确、加 `ZS-below 800` 落盘为 `ZS-below=800`、重复的 `ZS-below 860` 与空阈值 `GF-above` 被丢掉、保存后面板回填与实际一致；测试结束后 `rules.json` 已还原为你原来的 3 条（逐字段比对一致，仅键顺序不同）。
- **仍需肉眼确认**：设置页三列下拉在你机器上的实际宽度与配色；删除按钮 `×` 的位置是否好点。

### 修复：关掉涨跌方向后价格颜色跟着变白

- **现象**：在面板取消勾选「下跌」后，任务栏文字与悬浮球的金价从绿色变成白色，看着像数据挂了；「上涨」同理。
- **根因**：`readout()` 把两件事混成一个判定——`showPct` 返回 false 时 direction 记为 0，于是 `tone` 也变成 `flat`。开关本该只管箭头，却连带决定了颜色。
- **做法**：core 拆成两个函数——`priceTone(pct)` 只看真实涨跌（涨红、跌绿，**持平与缺失都是 flat/白**），`showArrow(pct, display)` 决定箭头（该方向被关掉、或持平、或数据缺失都不出现，避免出现"白色价格配 ▲"）。`showPct` 删除；`formatQuoteCells` 的 `tone` 也改成调用 `priceTone`，`QuoteCells.tone` 去掉多余的 `none` 态，面板 `TONE_CLASS` 同步。VS Code 状态栏箭头改用同一套判定（持平不再显示 ▲）。
- **验证**：`verify:display` 换成 8 条颜色/箭头断言（关掉下跌后 `priceTone(-0.4)` 仍是 `down` 且箭头隐藏、持平不配箭头、缺失为白色等），`verify:all` 五套共 130 条 PASS。CDP 实测任务栏与悬浮球：全开 `price down` 绿色 `rgb(74,222,128)` / `rgb(38,162,105)` + `▼`；关掉下跌后箭头消失但 class 仍是 `price down`、颜色不变；恢复全开箭头回来。
- **仍需肉眼确认**：绿色在你那块任务栏浅色底上的对比度是否够（截图看是清楚的）。

### 面板四处调整：箭头合成下拉框、拖拽跟手、提醒用选择行、悬浮球等比缩放

- **涨跌箭头合并成一个下拉框**：设置页原来两个勾选（上涨/下跌）换成一个 `涨跌箭头` 下拉：`涨跌都显示 / 只显示上涨 / 只显示下跌 / 不显示箭头`。落盘仍是 `display.up` / `display.down` 两个布尔，老配置不用迁移；互转放在 core 的 `arrowModeOf` / `displayFromArrowMode`，选项与文案由 `ARROW_MODE_ORDER` / `ARROW_MODE_TEXT` 下发。切换只影响箭头，价格颜色仍由 `priceTone` 决定。
- **详情页拖拽排序改成真的跟手**：旧实现里"长按计时未到就先移动"会被判成普通手势并取消长按，于是自然地去拖根本排不了序。现在长按计时期间不取消，到点仍按住就进入拖拽并按最新指针位置立刻排一次；进入拖拽前的移动会抑制随后的 click，避免误改主显品种。
- **到价提醒改成选择行**：去掉「＋ 新增提醒」按钮，规则列表末尾固定一条虚线分隔的空白行（品种下拉默认「选择品种…」+ 方向下拉 + 阈值），选品种填阈值后点保存即生效；core 的 `compileRules` 继续负责丢空值、去重与 id 约定。
- **悬浮球等比例缩放**：`settings.ball.scale`（0.6–1.8，区间与尺寸算法在 core：`BALL_SCALE_MIN/MAX`、`clampBallScale`、`ballSizeFor`、`scaledSquare`），窗口尺寸与 `zoomFactor` 同步变化，字号/圆角/边框一起等比放大；缩放围绕球心，避免每调一档球就往右下挪。设置页加「大小」滑杆（区间从 core 下发）。顺带修：`ball:move-by` 的增量要乘 `scale`，否则放大后球比鼠标快。
- **验证**：`verify:display` 新增 15 条（箭头模式四种往返、不动品种名开关、模式与颜色互不影响；缩放上下限、脏值退回、150% = 156px、球心不变、缩小后仍夹得回工作区），五套共 **147 条 PASS**，`npm run probe` 无错误。CDP 实测：`none` 时任务栏 `price down` 仍绿、箭头为空，`both` 时 `▼` 回来；球 100%→150% 窗口 104→156 且球心 (1837,816) 不变、落盘 `scale=1.5`；提醒选择行填 浙商/涨到/999 保存后 `rules.json` 出现 `ZS-above=999` 并回填成新的一行 + 空白行；详情页"按下即移动"的拖拽成功把 ZS 排到第三位且没有误改主显品种。测试后规则与顺序、缩放都已还原。
- **仍需肉眼确认**：球放大后文字边缘是否发虚（用的是 zoomFactor 缩放，理论上矢量清晰）；箭头下拉框与大小滑杆的排版宽度。

## 2026-11-05

### 新增

- 项目初始化：pnpm workspace，`packages/core` + `apps/*` 结构，Node 原生 TS 直跑，无构建步骤。
- **建行数据源**（`core/sources/ccb.ts`）：解析 `zhgjs_new.xml`，含品种码映射、北京时间换算。`probe` 验证 9 条报价。
- **提醒引擎**（`core/alerts.ts`）：到价与涨跌幅规则，改为上升沿触发；`core/store.ts` 原子落盘、当日涨跌幅基准、冷却与规则锁存。
- **Mac 菜单栏**（`apps/menubar`）：托盘价格、面板（买卖价/点差/更新时效）、原生通知、单实例锁、`LSUIElement` 纯菜单栏、唤醒后补一次取数。
- **VS Code 扩展**（`apps/vscode`）：状态栏价格与涨跌箭头、tooltip 对比表、切换品种 / 设提醒 / 暂停轮询 / 立即刷新。
- **京东多银行数据源**（`core/sources/jd.ts`）：一个批量接口覆盖六家，零登录，约 90ms；sku 与银行映射取自频道页 bundle 中写死的映射表。
- 三套离线验证脚本：`verify-health` / `verify-notify` / `verify-vscode`，均以真实代码路径 + stub 服务器方式断言。

### 发现

- 建行的"黄金积存"公开 feed 已冻结在 2026-07-27，日线接口是静态挡板（对 `sec_code` 不敏感），不可用。
- 积存金实时价并不在各家银行官网，而在京东金融的代销渠道里。
- 建行 feed 中 `PM_Txn_Vrty_Cd=23` 疑似积存金当日价（与 10:30 定价口径吻合），待复核。
