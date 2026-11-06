import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  compileRules,
  evaluateRules,
  QuoteStore,
  ruleIdOf,
  ruleKindOf,
  RULE_COOLDOWN_MINUTES,
  type AlertRule,
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
check('到价 id 是 品种-方向', ruleIdOf('ZS', 'above') === 'ZS-above' && ruleIdOf('JJC', 'below') === 'JJC-below');
check('涨跌幅 id 用 swing，与预置规则一致', ruleIdOf('AU9999', 'swing') === 'AU9999-swing');
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
  { symbol: 'AU9999', kind: 'swing', value: '1.2', enabled: true },
]);
check('字符串阈值被收进数字', rows[0].below === 870.5, JSON.stringify(rows[0]));
check('方向决定阈值落在哪个字段', rows[1].above === 900 && rows[2].absDayChangePct === 1.2);
check('id 与品种对齐', rows.map((r) => r.id).join(',') === 'ZS-below,GS-above,AU9999-swing', rows.map((r) => r.id).join(','));
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

rmSync(storeFile, { force: true });

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
