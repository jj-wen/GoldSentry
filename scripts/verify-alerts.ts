import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  compileRules,
  evaluatePortfolioRules,
  evaluateRules,
  PORTFOLIO_SYMBOL,
  portfolioSummary,
  QuoteStore,
  ruleIdOf,
  ruleKindOf,
  RULE_COOLDOWN_MINUTES,
  type AlertRule,
  type CalcRecord,
  type Quote,
} from '../packages/core/src/index.ts';

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS'  : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

const NOW = Date.now();

function quote(symbol: string, buyPrice: number, dayChangePct = 0): Quote {
  return {
    sourceId: 'test',
    symbol,
    name: `${symbol} 积存金`,
    label: symbol,
    currency: 'CNY',
    unit: 'GRAM',
    buyPrice,
    sellPrice: buyPrice - 0.5,
    midPrice: buyPrice - 0.25,
    spread: 0.5,
    basis: 'realtime',
    dayChangePct,
    quotedAt: NOW,
    fetchedAt: NOW,
  };
}

// --- id 约定：两端必须写成同一条，否则面板设的提醒 VS Code 看不到 ---
check('到价 id 是 品种-方向', ruleIdOf('ZS', 'above') === 'ZS-above' && ruleIdOf('MS', 'below') === 'MS-below');
check('涨跌幅 id 用 swing，与预置规则一致', ruleIdOf('ZX', 'swing') === 'ZX-swing');
check(
  '方向能从规则反推',
  ruleKindOf({ id: 'a', symbol: 'ZS', enabled: true, above: 1, cooldownMinutes: 1 }) === 'above' &&
    ruleKindOf({ id: 'b', symbol: 'ZS', enabled: true, below: 1, cooldownMinutes: 1 }) === 'below' &&
    ruleKindOf({ id: 'c', symbol: 'ZS', enabled: true, absDayChangePct: 1, cooldownMinutes: 1 }) === 'swing',
);

// --- 面板提交的是 DOM 脏值 ---
const rows = compileRules([
  { symbol: 'ZS', kind: 'below', value: '870.5', enabled: true },
  { symbol: 'GS', kind: 'above', value: 900, enabled: false },
  { symbol: 'ZX', kind: 'swing', value: '1.2', enabled: true },
]);
check('字符串阈值被收进数字', rows[0].below === 870.5, JSON.stringify(rows[0]));
check('方向决定阈值落在哪个字段', rows[1].above === 900 && rows[2].absDayChangePct === 1.2);
check('id 与品种对齐', rows.map((r) => r.id).join(',') === 'ZS-below,GS-above,ZX-swing', rows.map((r) => r.id).join(','));
check('启用状态原样保留', rows[0].enabled === true && rows[1].enabled === false);
check(
  '冷却按方向给',
  rows[0].cooldownMinutes === RULE_COOLDOWN_MINUTES.below && rows[2].cooldownMinutes === RULE_COOLDOWN_MINUTES.swing,
);
check('同品种同方向只留第一条', compileRules([
  { symbol: 'ZS', kind: 'below', value: 800, enabled: true },
  { symbol: 'ZS', kind: 'below', value: 900, enabled: true },
]).length === 1);
check('同品种不同方向算两条', compileRules([
  { symbol: 'ZS', kind: 'below', value: 800, enabled: true },
  { symbol: 'ZS', kind: 'above', value: 900, enabled: true },
]).length === 2);
check('阈值留空/非法的行直接丢掉', compileRules([
  { symbol: 'ZS', kind: 'below', value: '', enabled: true },
  { symbol: 'ZS', kind: 'below', value: 'abc', enabled: true },
  { symbol: 'ZS', kind: 'below', value: '-5', enabled: true },
  { symbol: 'ZS', kind: 'below', value: '0', enabled: true },
]).length === 0);
check('缺品种的行丢掉', compileRules([{ symbol: '  ', kind: 'below', value: 800, enabled: true }]).length === 0);
check('脏方向退回跌到', compileRules([{ symbol: 'ZS', kind: 'nonsense', value: 800, enabled: true }])[0].below === 800);
check('整个入参不是数组也不炸', compileRules(undefined).length === 0 && compileRules('ZS').length === 0);

// --- 组合盈亏规则：不绑具体银行，统一用保留品种码 ---
const pnlRows = compileRules([
  { symbol: '', kind: 'pnlPctAbove', value: '5', enabled: true },
  { symbol: '', kind: 'pnlPctBelow', value: '3', enabled: true },
  { symbol: '', kind: 'pnlAmountAbove', value: '1000', enabled: true },
  { symbol: '', kind: 'pnlAmountBelow', value: '500', enabled: true },
]);
check('组合规则没有品种也能保存', pnlRows.length === 4, String(pnlRows.length));
check(
  '组合规则固定用 PORTFOLIO',
  pnlRows.every((rule) => rule.symbol === PORTFOLIO_SYMBOL),
  pnlRows.map((rule) => rule.symbol).join(','),
);
check(
  '组合阈值落在对应字段',
  pnlRows[0].pnlPctAbove === 5 && pnlRows[1].pnlPctBelow === 3 && pnlRows[2].pnlAmountAbove === 1000 && pnlRows[3].pnlAmountBelow === 500,
);
check(
  '组合方向能从规则反推',
  pnlRows.every((rule, index) => ruleKindOf(rule) === ['pnlPctAbove', 'pnlPctBelow', 'pnlAmountAbove', 'pnlAmountBelow'][index]),
);

// --- 上升沿：换品种后这条约定不能破 ---
const storeFile = join(tmpdir(), `gs-alerts-${Date.now()}.json`);
const store = new QuoteStore(storeFile);
const rule: AlertRule[] = [{ id: 'ZS-below', symbol: 'ZS', enabled: true, below: 900, cooldownMinutes: 120 }];

const warm = evaluateRules(rule, quote('ZS', 880), store, NOW);
check('首轮静默预热（已满足条件也不弹）', warm.length === 0, JSON.stringify(warm));
const sameSide = evaluateRules(rule, quote('ZS', 879), store, NOW + 1000);
check('停在同一侧不重复弹', sameSide.length === 0);
const escaped = evaluateRules(rule, quote('ZS', 950), store, NOW + 2000);
check('条件转假不弹', escaped.length === 0);
const crossed = evaluateRules(rule, quote('ZS', 881), store, NOW + 3000);
check('由假变真才弹一次', crossed.length === 1 && crossed[0].symbol === 'ZS', crossed.map((a) => a.title).join(' / '));
check('提醒文案带阈值与现价', crossed[0]?.body.includes('阈值 900.00') && crossed[0]?.body.includes('现价 881.00'), crossed[0]?.body ?? '');
const again = evaluateRules(rule, quote('ZS', 950), store, NOW + 4000);
const inCooldown = evaluateRules(rule, quote('ZS', 880), store, NOW + 5000);
check('冷却期内再次穿越不重复弹', again.length === 0 && inCooldown.length === 0);
const otherSymbol = evaluateRules([{ ...rule[0], symbol: 'GS' }], quote('ZS', 800), store, NOW + 6000);
check('规则只匹配自己的品种', otherSymbol.length === 0);
const disabled = evaluateRules([{ ...rule[0], enabled: false }], quote('ZS', 700), store, NOW + 7000);
check('关掉后不弹', disabled.length === 0);

// --- 组合盈亏：上升沿、冷却、缺价与无记录 ---
const pnlFile = join(tmpdir(), `gs-pnl-${Date.now()}.json`);
const pnlStore = new QuoteStore(pnlFile);
const pnlRecords: CalcRecord[] = [
  { id: 'p1', side: 'buy', symbol: 'ZS', date: '2026-11-01', grams: 10, price: 800, createdAt: 0 },
  { id: 'p2', side: 'buy', symbol: 'GS', date: '2026-11-01', grams: 2, price: 810, createdAt: 1 },
];
const pnlRules: AlertRule[] = [
  { id: 'PORTFOLIO-pnlPctAbove', symbol: PORTFOLIO_SYMBOL, enabled: true, pnlPctAbove: 5, cooldownMinutes: 180 },
  { id: 'PORTFOLIO-pnlPctBelow', symbol: PORTFOLIO_SYMBOL, enabled: true, pnlPctBelow: 3, cooldownMinutes: 180 },
  { id: 'PORTFOLIO-pnlAmountAbove', symbol: PORTFOLIO_SYMBOL, enabled: true, pnlAmountAbove: 500, cooldownMinutes: 180 },
];
const high = portfolioSummary(pnlRecords, { ZS: 900, GS: 850 });
const low = portfolioSummary(pnlRecords, { ZS: 810, GS: 820 });
const loss = portfolioSummary(pnlRecords, { ZS: 770, GS: 780 });
const partialPnl = portfolioSummary(pnlRecords, { ZS: 900 });

check('组合首轮静默预热', evaluatePortfolioRules(pnlRules, high, pnlStore, NOW).length === 0);
check('回落后状态转假', evaluatePortfolioRules(pnlRules, low, pnlStore, NOW + 1000).length === 0);
const pnlFired = evaluatePortfolioRules(pnlRules, high, pnlStore, NOW + 2000);
check('浮盈穿越阈值触发百分比与金额两条', pnlFired.length === 2, pnlFired.map((a) => a.title).join(' / '));
check(
  '浮盈文案带现值和触发线',
  !!pnlFired[0]?.title.includes('浮盈') && !!pnlFired[0]?.body.includes('触发线 +5%'),
  pnlFired[0]?.body,
);
check(
  '金额规则文案带触发金额',
  !!pnlFired[1]?.body.includes('触发线 +500.00 元'),
  pnlFired[1]?.body,
);
evaluatePortfolioRules(pnlRules, low, pnlStore, NOW + 3000);
check('冷却期内再次穿越不重复弹', evaluatePortfolioRules(pnlRules, high, pnlStore, NOW + 4000).length === 0);
const lossFired = evaluatePortfolioRules(pnlRules, loss, pnlStore, NOW + 5000);
check('浮亏达到阈值触发', lossFired.length === 1 && lossFired[0].title.includes('浮亏'), lossFired.map((a) => a.title).join(' / '));
check('缺价时不拿不完整合计误报', evaluatePortfolioRules(pnlRules, partialPnl, pnlStore, NOW + 6000).length === 0);
check('没有记录时组合规则不弹', evaluatePortfolioRules(pnlRules, null, pnlStore, NOW + 7000).length === 0);
rmSync(pnlFile, { force: true });

rmSync(storeFile, { force: true });

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
