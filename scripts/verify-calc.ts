import {
  calcAmount,
  calcDeleteError,
  calcEstimate,
  calcEstimateText,
  calcLedger,
  calcLedgersBySymbol,
  calcSelection,
  formatGrams,
  isCalcDate,
  normalizeCalcRecords,
  portfolioSummary,
  type CalcRecord,
} from '../packages/core/src/index.ts';

let failures = 0;

function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

function record(
  id: string,
  side: 'buy' | 'sell',
  date: string,
  grams: number,
  price: number,
  createdAt = 0,
  symbol = 'ZS',
): CalcRecord {
  return { id, side, symbol, date, grams, price, createdAt };
}

const near = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) < epsilon;

// 1) 克数与日期格式化
check('克数整数不带小数', formatGrams(7) === '7g', formatGrams(7));
check('克数保留到三位', formatGrams(1.23456) === '1.235g', formatGrams(1.23456));
check('半个克数显示 0.5g', formatGrams(0.5) === '0.5g', formatGrams(0.5));
check('缺失克数显示 —', formatGrams(undefined) === '—');
check('合法日期通过', isCalcDate('2026-11-09'));
check('2 月 31 日被拒', !isCalcDate('2026-02-31'));
check('非 YYYY-MM-DD 被拒', !isCalcDate('2026/11/09'));

// 2) 脏记录清洗
const cleaned = normalizeCalcRecords([
  record('a', 'buy', '2026-10-23', 5, 905.34),
  record('b', 'buy', '2026-10-23', 1, 862.5, 1),
  { id: 'bad-side', side: 'hold', date: '2026-10-23', grams: 1, price: 1, createdAt: 0 },
  { id: 'bad-date', side: 'buy', date: '2026-02-31', grams: 1, price: 1, createdAt: 0 },
  { id: 'bad-grams', side: 'buy', date: '2026-10-23', grams: -1, price: 1, createdAt: 0 },
  { id: '', side: 'buy', date: '2026-10-23', grams: 1, price: 1, createdAt: 0 },
  record('a', 'buy', '2026-10-24', 2, 900),
]);
check('清洗后只留合法且不重复的记录', cleaned.length === 2, JSON.stringify(cleaned.map((item) => item.id)));
check('克数按三位小数落库', normalizeCalcRecords([record('x', 'buy', '2026-10-23', 1.23456, 900)])[0].grams === 1.235);
check('单价按两位小数落库', normalizeCalcRecords([record('y', 'buy', '2026-10-23', 1, 900.126)])[0].price === 900.13);

// 3) 选中买入的均价口径（卖出不参与）
const buys = [
  record('b1', 'buy', '2026-10-23', 5, 905.34),
  record('b2', 'buy', '2026-10-23', 1, 862.5, 1),
  record('b3', 'buy', '2026-10-23', 1, 855, 2),
  record('s1', 'sell', '2026-10-24', 2, 950, 3),
];
const allBuys = calcSelection(buys, ['b1', 'b2', 'b3']);
check('选中三笔买入合计 7g', near(allBuys.grams, 7), String(allBuys.grams));
check('总成本为逐笔成本之和', near(allBuys.cost, 6244.2), allBuys.cost.toFixed(2));
check('平均价 = 总成本 / 克数', near(allBuys.avgPrice ?? 0, 6244.2 / 7), String(allBuys.avgPrice));
const subset = calcSelection(buys, ['b2', 'b3', 's1']);
check('只统计选中的买入，卖出不参与', near(subset.grams, 2) && near(subset.cost, 1717.5), `${subset.grams}g / ${subset.cost}`);
check('没有选中买入时均价为 null', calcSelection(buys, ['s1']).avgPrice === null);

// 4) 移动加权平均：买入抬成本，卖出按当时均价结算
const ledger = calcLedger([
  record('k1', 'buy', '2026-10-01', 10, 800, 1),
  record('k2', 'buy', '2026-10-02', 10, 900, 2),
  record('k3', 'sell', '2026-10-03', 5, 950, 3),
]);
check('卖出后持仓 15g', near(ledger.grams, 15), formatGrams(ledger.grams));
check('剩余成本按均价扣减', near(ledger.cost, 12750), String(ledger.cost));
check('卖出不改变持仓均价', near(ledger.avgCost ?? 0, 850), String(ledger.avgCost));
check('已实现盈亏 = 卖出回款 − 成本', near(ledger.realized, 500), String(ledger.realized));
check('正常账本不报不一致', !ledger.invalid && ledger.invalidNote === '');

// 5) 卖出超过持仓：可卖部分照算，但必须标出问题
const oversold = calcLedger([
  record('o1', 'buy', '2026-10-01', 5, 800, 1),
  record('o2', 'sell', '2026-10-02', 8, 900, 2),
]);
check('超卖后持仓归零', near(oversold.grams, 0), formatGrams(oversold.grams));
check('超卖被标为不一致并说明日期', oversold.invalid && oversold.invalidNote.includes('2026-10-02'), oversold.invalidNote);
check('超卖按实际可卖克数结算盈亏', near(oversold.realized, 500), String(oversold.realized));

// 6) 删除校验：不能把后面的卖出变成超卖
check('删掉一笔买入不影响账本时放行', calcDeleteError(buys, ['b1']) === null);
const blocked = calcDeleteError(
  [record('d1', 'buy', '2026-10-01', 5, 800, 1), record('d2', 'sell', '2026-10-02', 3, 900, 2)],
  ['d1'],
);
check('删完买入会让卖出超仓时拦截', blocked !== null && blocked.includes('ZS'), blocked ?? '');

// 6.1) 多银行：删一家银行不会影响另一家的账本
const mixed = [
  record('m1', 'buy', '2026-10-01', 5, 800, 1, 'ZS'),
  record('m2', 'sell', '2026-10-02', 3, 900, 2, 'ZS'),
  record('m3', 'buy', '2026-10-01', 2, 810, 3, 'GS'),
  record('m4', 'sell', '2026-10-03', 2, 880, 4, 'GS'),
];
const crossBank = [
  record('c1', 'buy', '2026-10-01', 5, 800, 1, 'ZS'),
  record('c2', 'sell', '2026-10-02', 3, 900, 2, 'ZS'),
  record('c3', 'buy', '2026-10-01', 10, 800, 3, 'GS'),
];
check('删除另一家银行不影响别家', calcDeleteError(crossBank, ['c3']) === null);
const afterDelete = crossBank.filter((item) => item.id !== 'c1');
check('全局账本会掩盖跨行超卖', calcLedger(afterDelete).invalid === false);
const mixedBlocked = calcDeleteError(crossBank, ['c1']);
check('按银行校验能拦住跨行超卖并标明银行', mixedBlocked !== null && mixedBlocked.includes('ZS'), mixedBlocked ?? '');

const perBank = calcLedgersBySymbol(mixed);
check('按银行拆出两本账', perBank.length === 2, JSON.stringify(perBank.map((item) => item.symbol)));
const zsLedger = perBank.find((item) => item.symbol === 'ZS')?.ledger;
const gsLedger = perBank.find((item) => item.symbol === 'GS')?.ledger;
check('浙商账本独立计算', near(zsLedger?.grams ?? 0, 2) && near(zsLedger?.cost ?? 0, 1600), JSON.stringify(zsLedger));
check('工商账本独立计算', near(gsLedger?.grams ?? 0, 0) && near(gsLedger?.realized ?? 0, 140), JSON.stringify(gsLedger));

// 6.2) 组合汇总：各自实时卖出价，缺价时合计不完整
const summary = portfolioSummary(mixed, { ZS: 900, GS: 880 });
check('组合持仓克数合计', summary !== null && near(summary.grams, 2), String(summary?.grams));
check('组合市值按各自卖出价', summary !== null && near(summary.value, 1800), String(summary?.value));
check('组合浮动盈亏', summary !== null && near(summary.pnl, 200), String(summary?.pnl));
check('组合收益率按剩余成本', summary !== null && near(summary.pnlPct ?? 0, 12.5), String(summary?.pnlPct));
const heldMixed = [...mixed, record('m5', 'buy', '2026-10-04', 1, 820, 5, 'GS')];
const partial = portfolioSummary(heldMixed, { ZS: 900 });
check('缺少一家价格时标记不完整', partial !== null && partial.complete === false && partial.pnlPct === null, JSON.stringify(partial));
check('没有记录时不给组合', portfolioSummary([], { ZS: 900 }) === null);

// 6.3) 旧记录迁移到 fallback 银行
const migrated = normalizeCalcRecords(
  [{ id: 'old', side: 'buy', date: '2026-10-01', grams: 1, price: 800, createdAt: 0 }],
  'GS',
);
check('旧记录没有银行时按主显银行迁移', migrated[0]?.symbol === 'GS', JSON.stringify(migrated));

// 7) 模拟盈亏：按实时卖出价估值
const estimate = calcEstimate(ledger, 950);
check('持仓市值 = 持仓 × 卖出价', estimate !== null && near(estimate.value, 14250), String(estimate?.value));
check('浮动盈亏 = 市值 − 剩余成本', estimate !== null && near(estimate.pnl, 1500), String(estimate?.pnl));
check('收益率按剩余成本计算', estimate !== null && near(estimate.pnlPct ?? 0, (1500 / 12750) * 100), String(estimate?.pnlPct));
check('盈利显示红色（up）', estimate?.tone === 'up');
check('无持仓时不给模拟盈亏', calcEstimate(calcLedger([]), 950) === null);
check('无价格时不给模拟盈亏', calcEstimate(ledger, undefined) === null);
const estimateText = calcEstimateText(estimate);
check('浮盈文案带正号', estimateText.pnl === '+1500.00', estimateText.pnl);
check('收益率文案带正号', estimateText.pct === '+11.76%', estimateText.pct);
check('空估算显示 —', calcEstimateText(null).pnl === '—');

// 8) 单笔成本与乱序输入
check('单笔成本 = 克数 × 单价', near(calcAmount(record('a1', 'buy', '2026-10-23', 5, 905.34)), 4526.7));
const unordered = calcLedger([
  record('u3', 'sell', '2026-10-03', 5, 950, 3),
  record('u1', 'buy', '2026-10-01', 10, 800, 1),
  record('u2', 'buy', '2026-10-02', 10, 900, 2),
]);
check('乱序记录按日期重排后计算', near(unordered.realized, 500) && near(unordered.grams, 15), `${unordered.grams}g / ${unordered.realized}`);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
