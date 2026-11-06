# GoldSentry

监控多家银行**积存金**实时价，到价 / 涨跌幅提醒，多渠道推送。当前有 **Mac 菜单栏**、**Windows 托盘（含任务栏文字与悬浮球）** 和 **VS Code 状态栏** 三种形态，共用同一套与端无关的核心逻辑。

> 数据来源为公开行情接口（含逆向接口），仅供个人参考，不构成投资建议。

## 当前状态

| 形态 | 状态 | 说明 |
|---|---|---|
| Mac 菜单栏 App | 可运行，已出未签名 `.dmg` | 托盘实时价、六家银行对比、到价提醒、原生通知 + Bark 推送 |
| Windows 托盘 App | 源码/开发态可运行；已出 portable / NSIS，本机安装版被 Smart App Control 拦（未签名） | 托盘实时价、**任务栏文字**（TrafficMonitor 式贴附）、**可调透明度悬浮球**、到价提醒、Bark 推送 |
| VS Code 扩展 | 可运行 | 状态栏实时价、左键 QuickPick 对比表、4 个命令、提醒、Bark 推送 |
| 浏览器插件 | 未开始 | 核心可直接复用，只差外壳 |

核心能力已验证：多源取数、穿越触发提醒、源失效检测（三态）、Bark 推送（含失败上报）、金额两位小数与 Windows 任务栏贴附几何。

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
7. **Windows 未签名产物被 Smart App Control 拦**：本机 `VerifiedAndReputablePolicyState=1`，安装版与 `win-unpacked` 的 exe 实测启动即 `Permission denied`（退出码 126），CodeIntegrity 事件 3033/3077，策略 ID `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`；早前 portable 曾启动过、同内容重建后就被拒，符合该系统按文件信誉判定的特征。这不是构建问题，火绒只与早期 NSIS 阶段有关。要让安装版能启动，只能由用户关闭 Smart App Control（系统级、不可直接逆）或使用代码签名证书；仅做 CDP 验证时可让本机 Electron 加载 `resources/app.asar`，但不要把它当日常启动方式。

## 验收清单

- [ ] `npm run probe` 能打印 9 条报价，无错误
- [ ] `npm run verify:all` 全绿（含展示格式与任务栏几何）
- [ ] 菜单栏显示中文短名、涨跌红绿、费用列、刷新间隔下拉可切换
- [ ] 点任意一行，菜单栏 / 任务栏文字 / 悬浮球数字随之切换
- [ ] Windows：任务栏文字贴在托盘左侧、两位小数、可拖动；悬浮球可拖动、滚轮调透明度
- [ ] 所有端的金额都是两位小数（含缺失时显示 `—`）
- [ ] 面板填 Bark key → 测试推送 → 手机收到
- [ ] 断网（`NODE_USE_ENV_PROXY=1 http_proxy=http://127.0.0.1:9`）时托盘出现 `×`，恢复后出现"已恢复"提醒

## 文档

- [变更记录](docs/CHANGELOG.md)
- [路线图与待办](docs/ROADMAP.md)
- [数据源细节](docs/DATA-SOURCES.md)
- [给 AI 助手的项目说明](AGENTS.md)
