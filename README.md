# GoldSentry

监控多家银行**积存金**实时价，到价 / 涨跌幅提醒，多渠道推送。当前有 **Mac 菜单栏** 和 **VS Code 状态栏** 两个形态，共用同一套与端无关的核心逻辑。

> 数据来源为公开行情接口（含逆向接口），仅供个人参考，不构成投资建议。

## 当前状态

| 形态 | 状态 | 说明 |
|---|---|---|
| Mac 菜单栏 App | 可运行，已出未签名 `.dmg` | 托盘实时价、六家银行对比、到价提醒、原生通知 + Bark 推送 |
| VS Code 扩展 | 可运行 | 状态栏实时价、tooltip 对比表、4 个命令、提醒、Bark 推送 |
| Windows 托盘 / 浏览器插件 | 未开始 | 核心可直接复用，只差外壳 |

核心能力已验证：多源取数、穿越触发提醒、源失效检测（三态）、Bark 推送（含失败上报）。

## 快速开始

```bash
pnpm install          # 需要 pnpm 10+；Node >= 22.18（用原生 TS 直跑，无构建步骤）
npm run probe         # 拉一次真实行情，打印全部品种，最快验证网络与解析
```

Mac 菜单栏：

```bash
npm run menubar       # 开发模式（先 bundle 再启动 Electron）
npm run menubar:dist  # 出 dmg，产物在 apps/menubar/release/
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
  src/fees.ts           人工核实的费率表（接口无此字段）
  src/notify.ts         Bark 推送
  src/poller.ts         取数 → 落样本 → 判断提醒与健康

apps/menubar/           Electron 薄壳（TS 源码 → esbuild bundle → asar）
apps/vscode/            VS Code 扩展（esbuild bundle，复用 core）
scripts/                probe 与三套 verify 脚本
docs/                   变更记录、路线图、数据源细节
```

设计原则：**逻辑进 core，外壳只做展示和宿主 API 适配**。加新形态（Windows / 浏览器插件）时不要复制业务逻辑。

## 数据源一览

| 品种 | 来源 | 频率 | 口径注意 |
|---|---|---|---|
| 浙商/民生/工商/广发/兴业/中信 | 京东金融批量接口 | 实时（秒级） | 自带涨跌幅；部分银行只给单边价，点差显示 0 |
| 建行账户金 Au99.99 / Au99.95 | 建行公开 XML | 实时 | 不给昨收，涨跌幅由本地当日首笔推算 |
| 建行积存金当日价 | 同上 feed 的 code 23 | 每日 10:30 定价 | 推断项，见 `docs/ROADMAP.md` |

接口细节、字段含义与已证伪的源见 [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md)。

## 关键约定

- **提醒是穿越触发**：只在条件由假变真时提醒一次，价格长期停在同一侧不会重复弹；首次取数只记基线不报警。
- **健康三态**：`ok / degraded / offline`，只在**状态变化**时告警。取数成功但报价长时间不更新同样判异常。
- **点差 0 不等于免费**：上游只给单边价时 `buyPrice == sellPrice`，真实成本要看费用列。
- **费率是静态表**：接口不返回费率，`fees.ts` 里每条都带 `asOf` 日期，改动时务必更新日期。
- **不要跨银行比较涨跌幅**：各家"昨收"定义不同，同一时刻可能一个显示跌、一个显示涨。

## 常见坑

1. **改了代码忘了重新 bundle**：菜单栏的 `main` 指向 `dist/main.cjs`，必须 `npm run menubar`（或 `menubar:dist`）而不是直接 `electron .`，否则跑的是旧代码。出包后可用 `grep 关键字 release/mac-arm64/GoldSentry.app/Contents/Resources/app.asar` 校验内容。
2. **pnpm 10 默认不跑依赖的构建脚本**：所以仓库根 `postinstall` 会显式补装 Electron 二进制（`scripts/ensure-electron.cjs`，走镜像下载约 100MB）。若该步骤失败，手动执行 `node scripts/ensure-electron.cjs` 重试。
3. **国内网络**：`.npmrc` 已配 Electron 镜像；`electron-builder` 的 dmg 工具链要另设 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`，否则会卡在 GitHub CDN。
4. **arm64 未签名应用**：`identity: null` 出的包能启动，但系统通知可能被静默丢弃——所以推送主通道走 Bark，不依赖原生通知。
5. **`--host-resolver-rules` 对主进程无效**：Electron 主进程的全局 `fetch` 走 Node undici，不是 Chromium 网络栈；要模拟断网请用 `NODE_USE_ENV_PROXY=1` + 死代理。
6. **不要用裸 `import.meta.dirname` 处理打包路径**：bundle 成 CJS 后用 `__dirname`。

## 验收清单

- [ ] `npm run probe` 能打印 9 条报价，无错误
- [ ] `npm run verify:all` 全绿
- [ ] 菜单栏显示中文短名、涨跌红绿、费用列、刷新间隔下拉可切换
- [ ] 点任意一行，菜单栏数字随之切换
- [ ] 面板填 Bark key → 测试推送 → 手机收到
- [ ] 断网（`NODE_USE_ENV_PROXY=1 http_proxy=http://127.0.0.1:9`）时托盘出现 `×`，恢复后出现"已恢复"提醒

## 文档

- [变更记录](docs/CHANGELOG.md)
- [路线图与待办](docs/ROADMAP.md)
- [数据源细节](docs/DATA-SOURCES.md)
- [给 AI 助手的项目说明](AGENTS.md)
