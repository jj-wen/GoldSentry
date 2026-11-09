# AGENTS.md

给在本仓库工作的 AI 助手：先读这一页，再动手。

## 这个项目是什么

监控多家银行积存金实时价的工具。核心逻辑在 `packages/core`，形态有 Mac 菜单栏、Windows 托盘（含任务栏文字与悬浮球，同一个 Electron 外壳）和 VS Code 扩展，三者都只做展示与宿主适配。

用户是前端背景、偏好中文、给结论先于过程、**要真实的验证结果而不是"应该能跑"**。改造旧功能时倾向新增入口并保留原路径。

## 必跑命令

```bash
npm run probe        # 真实拉取全部行情（改任何取数/解析代码后必须跑）
npm run verify:all   # 展示格式/任务栏几何 + 提醒规则 + 健康判定 + 均价计算器 + Bark 推送 + VS Code bundle 六套断言
npm run verify:display # 只跑金额格式、透明度、任务栏贴附几何/全屏覆盖、交易时段与更新列（已并入 verify:all）
npm run verify:alerts  # 只跑提醒规则：id 约定、脏输入清理、上升沿与冷却
npm run verify:calc    # 只跑均价计算器：加权均价、卖出扣减、超卖与删除校验
npm run menubar      # 启动菜单栏（内部会先 bundle）
npm run menubar:dist # 出 dmg
npm run menubar:dist:win # 出 Windows portable + NSIS（NSIS 见陷阱表）
npm run vscode:install
```

`verify:*` 不需要真机 UI，可以在无界面环境跑。菜单栏/扩展的**视觉**效果无法自动验证（本机屏幕录制权限被拒），涉及 UI 改动要明确告诉用户"需要你肉眼确认"，不要声称已验证。

Windows 机器额外注意：根脚本内部直接调 `pnpm`，新机器要先 `corepack enable pnpm`；`pnpm run` 每次执行前都会校验 lockfile，见下面两条陷阱。

## 硬性约定

1. **逻辑写进 `packages/core`，外壳只做展示。** 新增 Windows / 浏览器插件时不要复制业务逻辑。
2. **core 不引第三方依赖**，用 Node 原生能力（`fetch` / `node:fs` / `Intl`）。Node 直接跑 `.ts`（类型擦除），所以：
   - 不能用 `enum`、`namespace`、**构造器参数属性**；
   - 相对导入必须带 `.ts` 后缀；
   - 只用 `import type` 引入类型，否则运行时会去找不存在的导出。
3. **提醒必须上升沿触发**：条件由假变真才提醒。改 `alerts.ts` 时保住"首轮静默预热"和"同侧不重复"。
4. **健康状态只在变化时告警**，并区分"取数失败"和"取数成功但数据冻结"。**先判交易时段**：周末/法定节假日/节前停夜盘期间报价不动是预期行为，不能报陈旧（`core/market.ts`）。
5. **不提交任何密钥**。Bark device key 存在用户机器的 `userData/settings.json`，不在仓库里；文档和日志里也不要出现。
6. **费率不是实时数据**。`fees.ts` 每条都带 `asOf`，改值必须更新日期并说明出处；查不到就显示 `—`，不要编。
7. **金额展示一律走 core 的 `formatPrice` / `formatPct`**（固定两位小数，缺失显示 `—`），不要在面板、托盘、悬浮球、任务栏文字或扩展里手写 `toFixed`。新增展示位先补 `verify:display`。
8. **Windows 任务栏文字是覆盖窗口，不是系统内嵌**。几何只从显示器 `bounds` 与 `workArea` 的差推断（`core/taskbar.ts`）；系统任务栏窗口 Electron 读不到，别尝试依赖 `Shell_TrayWnd` 的字段或坐标。是否因全屏应用隐藏由窗口枚举结果 + `coversTaskbar` 决定（见陷阱表），不要拿全局通知状态判断。
9. **计算器金额也走 core**：均价、成本、已实现/浮动盈亏全部在 `core/calculator.ts` 算，面板只贴字符串；卖出按移动加权平均扣减成本，卖出超过持仓必须拦下或标红。
10. **点击语义不许分形态漂移**：左键=详情、右键=设置，托盘、悬浮球、任务栏文字一致。托盘不设 `contextMenu`（否则右键被菜单抢占），菜单项全部放在面板设置页里。VS Code 状态栏做不到左右键区分，用第二个 `$(gear)` 项承担设置入口，改动要在 README 与代码注释里说明这是平台限制。
11. **显示什么由 core 决定，不由外壳决定**。品种名/箭头/涨跌幅/颜色一律走 `settings.display`（`name` / `up` / `down` / `pct`）+ `core/format.ts` 的 `priceTone`（颜色：涨红跌绿，**持平与未知都是白色**）、`showArrow`（箭头：该方向被关掉或持平就不出现）、`arrowModeOf` / `displayFromArrowMode`（面板那个"涨跌箭头"下拉框与两个布尔的互转）与 `normalizeDisplay`；`pct` 默认关，打开后各端在价格后追加 `formatPct`，没有涨跌幅就整段不显示。新增展示位时不要自己判断方向。关掉某个方向**只隐藏箭头，不能把价格颜色也一起变白**（曾经踩过： tone 跟着开关走，关下跌后绿色价格变成白色，看着像数据挂了）。

## 已知陷阱（都是踩过的）

| 症状 | 原因 | 做法 |
|---|---|---|
| 打包后界面还是旧的 | 直接调了 `electron-builder`，跳过 `build:code` | 只用 `npm run menubar:dist`，并用 `grep 关键字 .../app.asar` 校验 |
| 启动报 `Cannot read properties of undefined` | 顶层 `state` 初始化引用了在后面声明的常量（TDZ） | 初始化用字面量，或把声明顺序调好 |
| Electron 起不来 / 下载失败 | pnpm 10 默认不跑依赖构建脚本，二进制拖到首次运行才下 | 根 `postinstall` 会调 `scripts/ensure-electron.cjs` 补装；失败就手动跑这个脚本 |
| dmg 构建卡在 GitHub | electron-builder 工具链走 GitHub CDN | 设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |
| 想模拟断网但无效 | `--host-resolver-rules` 只作用于 Chromium 网络栈 | 用 `NODE_USE_ENV_PROXY=1 http_proxy=http://127.0.0.1:9` |
| 推送失败但用户不知道 | 静默失败 | 失败必须回显到面板错误条并打日志 |
| 同一份数据两个进程互覆盖 | 旧实例还在后台跑 | 测试前 `pkill -f GoldSentry`，并确认 `pgrep` 为空 |
| Windows 上报 `pnpm 不是内部或外部命令` | 根脚本（`verify:all` / `menubar*`）内部直接调 `pnpm` | `corepack enable pnpm` 一次即可 |
| `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，esbuild 等装不上，脚本每次前面一大段 install 警告 | pnpm 12 默认拒绝安装 24 小时内发布的包（`undici` 命中） | 一次性 `pnpm install --trust-lockfile`（本次构建已这么做）；24 小时后自然通过。想彻底安静可本机 `pnpm config set verify-deps-before-run false`，**别提交进仓库** |
| `Cannot find native binding`（`@electron-internal/extract-zip`） | Windows 缺 VC++ 运行库，Electron 解压器的原生 `.node` 加载不了（`System32\vcruntime140*.dll` 全缺） | 装 VC++ 2015-2022 x64 运行库；或手动把 `~/AppData/Local/electron/Cache/*/electron-*-win32-x64.zip` 用 `Expand-Archive` 解到 `node_modules/.pnpm/electron@*/node_modules/electron/dist` 并写 `path.txt` = `electron.exe` |
| Windows 出 NSIS 报 `spawn UNKNOWN` | NSIS 必须先运行一次安装包来生成卸载器；早期本机联想火绒 `usysdiag.exe` 曾拦未签名 Electron 产物 | 重试构建；仍失败就先手动跑一次安装包生成卸载器，再排查杀软 |
| 新出的 `win-unpacked\GoldSentry.exe` / 安装版启动即 `Permission denied`（退出码 126） | 本机 **Windows Smart App Control（WDAC）** 在拦未签名 exe：`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy\VerifiedAndReputablePolicyState=1`，CodeIntegrity 事件 3033/3077，策略 ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`。不是构建问题，也与火绒无关 | 构建配置不用改。要让安装版能启动，只能由用户关闭 Smart App Control（系统级，关闭后不能直接再开）或提供代码签名证书；**不要**擅自改用可信 Electron 加载 asar 当日常启动来绕开策略。仅做 CDP 验证时可用本机 Electron 加载 `resources/app.asar`，或换一台没有该策略的机器 |
| `verify:*` 断言全 `PASS` 却非 0 退出，整条 `verify:all` 断掉 | Windows + Node 24：收尾 `process.exit()` 撞 libuv 断言 `UV_HANDLE_CLOSING` | 用 `process.exitCode = failures ? 1 : 0` 让事件循环自己排空。**不要**用 `setTimeout(...).unref()` 绕：定时器根本不触发，Node 以 0 退出，会把失败断言吞成通过 |
| grep 中文关键字到 `dist/*.cjs` / `app.asar` 里查不到，误判"产物还是旧的" | esbuild 默认把非 ASCII 字符转义成 `\uXXXX`，中文在 bundle 里不是原文 | 校验产物只用 ASCII 标识符（函数名、命令 id、英文 key），或直接对 bundle 求值后再查 |
| 改成 `process.exitCode` 后验证脚本挂住不退出 | 扩展/外壳自己挂了 `setInterval` 轮询，事件循环永远排不空 | 收尾先 dispose 掉注册的 disposable（`subscriptions.forEach(d => d.dispose?.())`），再设 `exitCode` |
| 任务栏文字位置/宽度不对，或任务栏自动隐藏后文字仍悬空 | Electron 没有读取系统任务栏的 API，位置只能由 `bounds` 与 `workArea` 的差推断 | 改 `core/taskbar.ts` 先跑 `verify:display`；两者几乎相等（自动隐藏）时必须隐藏；`placeOnTaskbar` 负责夹回任务栏范围 |
| preload 发了 IPC 但主进程毫无反应 | `ipcRenderer.send('x', a, b)` 与 `ipcMain.on('x', (_e, obj) => obj.a)` 参数形态不一致，`obj.a` 为 `undefined` 后静默早退 | 统一成单个对象参数（`send('x', { a, b })`）；IPC 入口先打一行日志确认消息真的到达 |
| 面板改完设置后表格整块变空，或点刷新后控制台抛异常 | handler 返回了局部字段（如顺序数组）甚至 `void`，而渲染层写的是 `.then(applyState)`，`innerHTML=''` 之后取 `next.quotes` 抛异常 | 凡是喂给 `applyState` 的 handler 一律返回完整 `state`（异步的先 `await` 再 return）；新增 IPC 先确认返回值形态再写 `.then` |
| CDP 合成指针事件点了没反应，或面板/球不响应 | 合成 `PointerEvent` 没有真实 `pointerId`，`setPointerCapture` / `releasePointerCapture` 抛错会把后面的 `click()` 一起打断 | 自动化时先把这两个方法空掉再派发；不要为此改生产代码 |
| 窗口刚创建就发消息，界面停在默认状态 | `show: false` 的窗口 `loadFile` 是异步的，`did-finish-load` 之前 `webContents.send` 会被丢 | 用 `panelReady` / `pendingMode` 这类标记在加载完成后补发；只靠"下一次轮询"会表现成偶发错乱 |
| 任务栏文字/悬浮球抢焦点、出现在 Alt+Tab | 普通 `BrowserWindow` 会被当成应用窗口 | `focusable:false` + `skipTaskbar:true` + `alwaysOnTop`，用 `showInactive()` 显示 |
| 任务栏文字拖一下整块看不见（窗口还在、`innerText` 仍在更新） | Windows 上 Chromium 用 DWM 遮挡计算判断窗口可见性；`focusable:false` 的置顶透明窗口盖在任务栏上容易被判成"全被遮挡"，于是停止绘制 | 启动时 `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`（仅 win32）。诊断时看渲染层的 `document.visibilityState`，光看 Win32 `IsWindowVisible` 会误判成正常 |
| 任务栏文字拖到最右就"消失"在时钟下面 | 可拖范围以前只夹到 `rect.width - width`，没减托盘安全边距 | `placeOnTaskbar` 的夹取上限同样减 `TASKBAR_END_MARGIN`；改几何先跑 `verify:display` |
| macOS 从 dmg 挂载目录开启开机自启，重启后路径失效 | `setLoginItemSettings` 可能把 `/Volumes/GoldSentry/...` 写进登录项 | `supportsLoginItem()` 检测 `app.getPath('exe').startsWith('/Volumes/')`；面板禁用并提示先拖进「应用程序」 |
| 开发态拨「开机自启」注册进去的是 Electron 本体 | `app.isPackaged === false` 时也会走系统 API | 开发态显示开关但禁用并说明原因；只在打包后的 mac/win 调 `setLoginItemSettings` |
| 全屏看视频时任务栏文字仍压在画面上 | 全屏应用的 `display.bounds` / `workArea` 不变，`detectTaskbar` 仍认为任务栏存在；`SHQueryUserNotificationState` 是整机全局状态（副屏全屏也会报繁忙），不能用来决定该隐藏哪一块 | `apps/menubar/src/fullscreen.ts` 用常驻 PowerShell 探针枚举可见且有标题的顶层窗口，把「窗口矩形≈所在显示器矩形」的显示器交给 `core/taskbar.ts` 的 `coversTaskbar`；只有全屏显示器盖住任务栏贴纸那块才隐藏，改这块先跑 `verify:display` |
| 退出全屏后任务栏文字再也不回来 | 枚举时把 DWM 已隐藏（`DWMWA_CLOAKED`）的窗口和桌面窗口当成了全屏；或探针进程被杀/卡住后主进程一直拿着旧的“有全屏”状态；或全屏应用退出留下同屏幽灵窗口 | 探针跳过 `DwmGetWindowAttribute(hwnd, 14) != 0`、壳类名，以及“不在前台且与前台同屏”的全屏尺寸窗口；探针每秒输出心跳，主进程 15 秒无数据就恢复文字并重启，退出/启动失败也先恢复；任务栏窗口被销毁要自愈重建 |
| 悬浮球放大后拖动比鼠标快 | `setZoomFactor` 放大页面后，1 个 CSS 像素 = scale 个屏幕像素，`movementX/Y` 是 CSS 像素 | `ball:move-by` 里把增量乘回 `settings.ball.scale` 再 `setPosition` |
| 面板长按拖拽排序"没反应" | 计时未到就移动被判定成普通手势并取消了长按 | 长按计时期间不要取消，到点且仍按住就进入拖拽并用最新指针位置排一次；进入前的移动要抑制随后的 click，否则会误改主显品种 |
| 托盘右键不触发设置，弹的是菜单 | `tray.setContextMenu()` 会抢占 right-click 事件 | 需要右键自定义行为时不要设 contextMenu，把菜单项搬进面板；`tray.on('right-click', ...)` 才会生效 |
| 周末/节假日面板报「部分异常 / 全部报价陈旧」 | 陈旧判定不看交易时段，银行休市时报价当然不动 | 陈旧循环只在 `marketSessionAt(now).open` 时执行；节假日表每年按上金所公告更新 `core/market.ts`，并同步 `MARKET_SCHEDULE_AS_OF` |
| 新增第二个状态栏项后 `verify:vscode` 报假失败 | 桩里 `createStatusBarItem` 每次返回同一个对象，后一项覆盖前一项的 `command` | 桩改成注册表（数组），按创建顺序分别断言；断言前要先取 `statusItems[0]` |
| 设了 `hidden` 的行/块仍然显示（DOM 里 `.hidden === true`） | 作者样式 `.ball-row { display:flex }` 优先级高于 UA 的 `[hidden] { display:none }` | 全局补 `[hidden] { display:none !important }`；自动化断言要用 `getComputedStyle(...).display`，只查 `.hidden` 会假通过，截图才看得见 |
| SVG 元素的 `hidden` 不生效：要么一直不显示，要么关了仍占宽度 | `SVGElement` 没有 `hidden` 这个 IDL 属性，赋值只挂扩展属性、不动内容属性；UA 的 `[hidden]` 规则也管不到 SVG | 用 `el.toggleAttribute('hidden', ...)` 改内容属性，并在样式里显式写 `.spark[hidden] { display:none }` |
| 暂停轮询后再恢复，永远不再刷新 | 暂停时 `clearInterval` 清掉了定时器，恢复只刷新一次却没重建 | 用每轮重排的 `setTimeout` 链，暂停只跳过取数、链保持活着；改轮询节奏时顺带检查 dispose/deactivate 清的是 `clearTimeout` |
| macOS 菜单栏价格想变红绿 | `tray.setTitle()` 在 macOS 只支持 `fontType`，系统标题是单色文字；托盘图片固定排在标题左边（`NSStatusItem` 的 `imagePosition` Electron 没暴露） | 颜色/位置要求用系统文字做不到时，把整条标题画成 2x PNG 当托盘图标（`status-renderer.ts`）：文字用系统色、末尾画彩色三角，别在标题里重复符号；渲染失败退回系统标题 + 左侧红 ▲/绿 ▼ 图标。只染某一位小数同理，必须走图片 |
| 图标文件看着正常，托盘/菜单栏却空白 | PNG 解压后每行比声明宽度多 1 字节，Chromium 解码器直接判空（`nativeImage.isEmpty() === true`） | 用 `isEmpty()` 校验资源；生成图标走 `scripts/make-tray-icons.cjs` 的自写编码器，别用会写出错行宽的旧工具 |

## 新增一家银行/一个数据源

1. 在 `packages/core/src/sources/` 加适配器，实现 `fetchQuotes(): Promise<Quote[]>`，**不要**在适配器里做提醒或展示逻辑。
2. 字段语义必须实测确认：哪个是客户买入价、哪个是客户卖出价、时间戳时区。不要凭字段名猜。
3. 在 `sources` 数组里注册（顺序影响兜底展示，实时源放前面）。
4. `npm run probe` 看输出是否符合预期，特别是点差和涨跌幅是否合理。
5. 如果是存疑的推断（比如某个品种码的含义），在 `docs/ROADMAP.md` 记一条待复核项，并在代码注释里写清依据。

## 改完自查

- [ ] `npm run probe` 无错误，数值合理
- [ ] `npm run verify:all` 全绿（含 `verify:display` 的金额/透明度/任务栏几何）
- [ ] 涉及打包 → 重新出包并 grep asar 校验
- [ ] 涉及 UI → 明确说明哪部分需要用户肉眼验收（任务栏文字是否盖在任务栏之上、主题对比度尤其无法自动验证）
- [ ] `docs/CHANGELOG.md` 补一条；待办变化同步 `docs/ROADMAP.md`
