import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPct, formatPrice, QuoteStore, pollOnce, sources, type AlertRule } from '../packages/core/src/index.ts';

const store = new QuoteStore(join(tmpdir(), 'goldsentry-probe.json'));
const rules: AlertRule[] = [];

function show(quotes: import('../packages/core/src/index.ts').Quote[]): void {
  for (const q of quotes) {
    console.log(
      `  ${q.label.padEnd(8)} ${q.symbol.padEnd(7)} 买 ${formatPrice(q.buyPrice)}  卖 ${formatPrice(q.sellPrice)}  点差 ${formatPrice(q.spread)}  涨跌 ${formatPct(q.dayChangePct).padStart(8)}  ${q.basis}`,
    );
  }
}

async function round(label: string): Promise<number> {
  const t0 = Date.now();
  const { quotes, alerts, errors } = await pollOnce(sources, store, rules);
  console.log(`\n--- ${label}  ${quotes.length} 条  ${Date.now() - t0}ms  错误 ${errors.length ? errors.join('; ') : '无'}`);
  show(quotes);
  for (const a of alerts) console.log(`  >>> 触发 [${a.ruleId}] ${a.title} — ${a.body}`);
  if (!alerts.length) console.log('  （无触发）');
  return alerts.length;
}

await round('全量取数');

const zs = (await sources[0].fetchQuotes()).find((q) => q.symbol === 'ZS')!;
console.log(`\n浙商积存金当前买入价 ${formatPrice(zs.buyPrice)}，用它构造穿越测试`);

rules.push({ id: 'ZS-above', symbol: 'ZS', enabled: true, above: zs.buyPrice - 5, cooldownMinutes: 0 });
if ((await round('第 1 轮：阈值已在价格下方（预热，不该弹）')) !== 0) console.log('  !! 不该触发');
if ((await round('第 2 轮：仍停在阈值同侧（不该重复弹）')) !== 0) console.log('  !! 不该重复触发');

rules[0].above = zs.buyPrice + 5;
await round('第 3 轮：阈值抬到现价上方（条件转假）');
rules[0].above = zs.buyPrice - 5;
if ((await round('第 4 轮：阈值压回现价下方（上升沿，该弹）')) === 0) console.log('  !! 穿越应当触发');
