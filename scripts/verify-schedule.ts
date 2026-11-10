import { buildDailyDigest, defaultCalcFees, inQuietHours, parseHhmm, timeReached, tradingDayKey } from '../packages/core/src/index.ts';

const at = (iso: string) => Date.parse(iso);

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

// --- HH:MM 解析 ---
check('HH:MM 解析成分钟', parseHhmm('08:30') === 510 && parseHhmm('23:59') === 1439);
check('非法时间返回 null', parseHhmm('24:00') === null && parseHhmm('8:3') === null && parseHhmm('') === null);

// --- 免打扰 ---
const quiet = { enabled: true, start: '12:00', end: '14:00' };
check('普通区间内命中', inQuietHours(quiet, at('2026-11-06T05:00:00Z')) === true); // 13:00
check('普通区间外不命中', inQuietHours(quiet, at('2026-11-06T02:00:00Z')) === false); // 10:00

const night = { enabled: true, start: '23:00', end: '08:00' };
check('跨午夜前段命中', inQuietHours(night, at('2026-11-06T15:30:00Z')) === true); // 23:30
check('跨午夜后段命中', inQuietHours(night, at('2026-11-06T23:30:00Z')) === true); // 次日 07:30
check('跨午夜区间外不命中', inQuietHours(night, at('2026-11-06T04:00:00Z')) === false); // 12:00
check('关闭时永不静音', inQuietHours({ ...night, enabled: false }, at('2026-11-06T15:30:00Z')) === false);
check('起止相同视为未设置', inQuietHours({ enabled: true, start: '12:00', end: '12:00' }) === false);

// --- 简报定时 ---
check('未到点不触发', timeReached('08:30', at('2026-11-06T00:20:00Z')) === false); // 08:20
check('到点后触发', timeReached('08:30', at('2026-11-06T00:30:00Z')) === true); // 08:30
check('时间非法不触发', timeReached('25:00', at('2026-11-06T00:30:00Z')) === false);

// --- 交易日口径：02:30 前的夜盘算前一交易日 ---
check('夜盘算前一交易日', tradingDayKey(at('2026-11-06T18:29:00Z')) === '2026-11-06');
check('白天算当天', tradingDayKey(at('2026-11-06T02:00:00Z')) === '2026-11-06');

// --- 每日简报 ---
const samples = [
  { symbol: 'ZS', ts: at('2026-11-06T02:00:00Z'), buyPrice: 880, sellPrice: 879.5 }, // 周五 10:00
  { symbol: 'ZS', ts: at('2026-11-06T06:00:00Z'), buyPrice: 890, sellPrice: 889.5 }, // 周五 14:00
  { symbol: 'ZS', ts: at('2026-11-06T14:00:00Z'), buyPrice: 885, sellPrice: 884.5 }, // 周五 22:00
  { symbol: 'ZS', ts: at('2026-11-06T17:00:00Z'), buyPrice: 882, sellPrice: 881.5 }, // 周五夜盘 01:00
  { symbol: 'GS', ts: at('2026-11-06T06:00:00Z'), buyPrice: 886, sellPrice: 885.5 },
];
const digest = buildDailyDigest(samples, { ZS: '浙商' }, at('2026-11-07T01:00:00Z')); // 周六 09:00
check('简报取最近一个已结束交易日', digest?.day === '2026-11-06', digest?.day);
check('开/收/高/低按交易日聚合', !!digest?.body.includes('开 880.00 收 882.00 高 890.00 低 880.00'), digest?.body);
check('涨跌幅相对当日开盘', !!digest?.body.includes('+0.23%'), digest?.body);
check('只汇总仍在监测的品种', !!digest && !digest.body.includes('工商'), digest?.body);
check('标题带交易日', digest?.title.includes('2026-11-06') === true, digest?.title);
check('没有历史数据时返回 null', buildDailyDigest([], { ZS: '浙商' }, at('2026-11-07T01:00:00Z')) === null);
check(
  '只统计已结束的交易日',
  buildDailyDigest(
    [{ symbol: 'ZS', ts: at('2026-11-07T02:00:00Z'), buyPrice: 900, sellPrice: 899 }],
    { ZS: '浙商' },
    at('2026-11-07T01:00:00Z'),
  ) === null,
);

// --- 选中的银行排第一 ---
const ordered = buildDailyDigest(samples, { ZS: '浙商', GS: '工商' }, at('2026-11-07T01:00:00Z'), {
  primarySymbol: 'GS',
});
check('选中的银行排第一行', ordered?.body.split('\n')[0]?.startsWith('工商') === true, ordered?.body);
check('其余银行保持原顺序', ordered?.body.split('\n')[1]?.startsWith('浙商') === true, ordered?.body);

// --- 计算器记录：模拟持仓与当日收益 ---
const portfolioSamples = [
  { symbol: 'ZS', ts: at('2026-11-05T06:00:00Z'), buyPrice: 870.5, sellPrice: 870 }, // 周四 14:00
  { symbol: 'ZS', ts: at('2026-11-06T02:00:00Z'), buyPrice: 880, sellPrice: 879.5 },
  { symbol: 'ZS', ts: at('2026-11-06T14:00:00Z'), buyPrice: 885, sellPrice: 884.5 }, // 周五 22:00
  { symbol: 'GS', ts: at('2026-11-06T06:00:00Z'), buyPrice: 886, sellPrice: 885.5 },
];
const records = [
  { id: 'b1', side: 'buy' as const, symbol: 'ZS', date: '2026-11-01', grams: 10, price: 800, createdAt: 0 },
  { id: 's1', side: 'sell' as const, symbol: 'ZS', date: '2026-11-06', grams: 2, price: 880, createdAt: 1 },
];
const withPortfolio = buildDailyDigest(portfolioSamples, { ZS: '浙商' }, at('2026-11-07T01:00:00Z'), {
  primarySymbol: 'ZS',
  calcRecords: records,
});
check(
  '模拟持仓按收盘卖出价估值',
  !!withPortfolio?.body.includes('模拟持仓（客户卖出价）') &&
    !!withPortfolio?.body.includes('浙商 8g · 成本 800.00 · 市值 ¥7076.00 · 浮动 +676.00（+10.56%）'),
  withPortfolio?.body,
);
check(
  '模拟收益含当日与累计已实现',
  !!withPortfolio?.body.includes('当日 +136.00（+1.56%）') &&
    !!withPortfolio?.body.includes('累计已实现 +160.00'),
  withPortfolio?.body,
);
const withFees = buildDailyDigest(portfolioSamples, { ZS: '浙商' }, at('2026-11-07T01:00:00Z'), {
  primarySymbol: 'ZS',
  calcRecords: records,
  calcFees: defaultCalcFees(),
});
check(
  '日报估值扣掉按银行配置的手续费',
  !!withFees?.body.includes('市值 ¥7047.70') &&
    !!withFees?.body.includes('浮动 +647.70（+10.12%）') &&
    !!withFees?.body.includes('当日 +135.46（+1.56%）') &&
    !!withFees?.body.includes('累计已实现 +152.96'),
  withFees?.body,
);
const noPrev = buildDailyDigest(
  portfolioSamples.filter((sample) => sample.ts >= at('2026-11-06T00:00:00Z')),
  { ZS: '浙商' },
  at('2026-11-07T01:00:00Z'),
  { primarySymbol: 'ZS', calcRecords: records },
);
check('缺前收时不硬编当日收益', !!noPrev && !noPrev.body.includes('当日'), noPrev?.body);
const noRecords = buildDailyDigest(portfolioSamples, { ZS: '浙商' }, at('2026-11-07T01:00:00Z'), {
  primarySymbol: 'ZS',
});
check('没有计算记录就不加持仓段', !!noRecords && !noRecords.body.includes('模拟持仓'), noRecords?.body);

// --- 多银行持仓：逐家估值并给合计 ---
const multiRecords = [...records, { id: 'b2', side: 'buy' as const, symbol: 'GS', date: '2026-11-01', grams: 2, price: 810, createdAt: 2 }];
const multi = buildDailyDigest(portfolioSamples, { ZS: '浙商', GS: '工商' }, at('2026-11-07T01:00:00Z'), {
  primarySymbol: 'GS',
  calcRecords: multiRecords,
});
check(
  '日报持仓逐家一行，主显银行在前',
  !!multi &&
    multi.body.includes('工商 2g · 成本 810.00 · 市值 ¥1771.00 · 浮动 +151.00（+9.32%）') &&
    multi.body.includes('浙商 8g · 成本 800.00 · 市值 ¥7076.00 · 浮动 +676.00（+10.56%）') &&
    multi.body.indexOf('工商 2g') < multi.body.indexOf('浙商 8g'),
  multi?.body,
);
check(
  '多银行给出合计',
  !!multi?.body.includes('合计 10g · 市值 ¥8847.00 · 浮动 +827.00（+10.31%） · 累计已实现 +160.00'),
  multi?.body,
);
check('缺一家前收时合计不带当日', !!multi && !multi.body.split('\n').at(-1)?.includes('当日'), multi?.body);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
