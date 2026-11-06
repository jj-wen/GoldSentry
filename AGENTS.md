# AGENTS.md

给在本仓库工作的 AI 助手：先读这一页，再动手。

## 这个项目是什么

监控多家银行积存金实时价的工具。核心逻辑在 `packages/core`，形态有 Mac 菜单栏（Electron）和 VS Code 扩展，两者都只做展示与宿主适配。

用户是前端背景、偏好中文、给结论先于过程、**要真实的验证结果而不是"应该能跑"**。改造旧功能时倾向新增入口并保留原路径。

## 必跑命令

```bash
npm run probe        # 真实拉取全部行情（改任何取数/解析代码后必须跑）
npm run verify:all   # 健康判定 + Bark 推送 + VS Code bundle 三套断言
npm run menubar      # 启动菜单栏（内部会先 bundle）
npm run menubar:dist # 出 dmg
npm run vscode:install
```

`verify:*` 不需要真机 UI，可以在无界面环境跑。菜单栏/扩展的**视觉**效果无法自动验证（本机屏幕录制权限被拒），涉及 UI 改动要明确告诉用户"需要你肉眼确认"，不要声称已验证。

## 硬性约定

1. **逻辑写进 `packages/core`，外壳只做展示。** 新增 Windows / 浏览器插件时不要复制业务逻辑。
2. **core 不引第三方依赖**，用 Node 原生能力（`fetch` / `node:fs` / `Intl`）。Node 直接跑 `.ts`（类型擦除），所以：
   - 不能用 `enum`、`namespace`、**构造器参数属性**；
   - 相对导入必须带 `.ts` 后缀；
   - 只用 `import type` 引入类型，否则运行时会去找不存在的导出。
3. **提醒必须上升沿触发**：条件由假变真才提醒。改 `alerts.ts` 时保住"首轮静默预热"和"同侧不重复"。
4. **健康状态只在变化时告警**，并区分"取数失败"和"取数成功但数据冻结"。
5. **不提交任何密钥**。Bark device key 存在用户机器的 `userData/settings.json`，不在仓库里；文档和日志里也不要出现。
6. **费率不是实时数据**。`fees.ts` 每条都带 `asOf`，改值必须更新日期并说明出处；查不到就显示 `—`，不要编。

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

## 新增一家银行/一个数据源

1. 在 `packages/core/src/sources/` 加适配器，实现 `fetchQuotes(): Promise<Quote[]>`，**不要**在适配器里做提醒或展示逻辑。
2. 字段语义必须实测确认：哪个是客户买入价、哪个是客户卖出价、时间戳时区。不要凭字段名猜。
3. 在 `sources` 数组里注册（顺序影响兜底展示，实时源放前面）。
4. `npm run probe` 看输出是否符合预期，特别是点差和涨跌幅是否合理。
5. 如果是存疑的推断（比如某个品种码的含义），在 `docs/ROADMAP.md` 记一条待复核项，并在代码注释里写清依据。

## 改完自查

- [ ] `npm run probe` 无错误，数值合理
- [ ] `npm run verify:all` 全绿
- [ ] 涉及打包 → 重新出包并 grep asar 校验
- [ ] 涉及 UI → 明确说明哪部分需要用户肉眼验收
- [ ] `docs/CHANGELOG.md` 补一条；待办变化同步 `docs/ROADMAP.md`
