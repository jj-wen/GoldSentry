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
