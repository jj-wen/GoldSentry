# 变更记录

按日期倒序。记录"做了什么、为什么、验证到了什么程度"，细节取舍见 `ROADMAP.md` 与 `DATA-SOURCES.md`。

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
