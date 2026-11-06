import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { QuoteStore, pollOnce, type Quote, type QuoteSource } from '../packages/core/src/index.ts';

const NOW = Date.now();

function quote(sourceId: string, symbol: string, buyPrice: number, quotedAt: number): Quote {
  return {
    sourceId,
    symbol,
    name: symbol,
    label: symbol,
    currency: 'CNY',
    unit: 'GRAM',
    buyPrice,
    sellPrice: buyPrice - 0.5,
    midPrice: buyPrice - 0.25,
    spread: 0.5,
    basis: 'realtime',
    dayChangePct: 0.1,
    quotedAt,
    fetchedAt: NOW,
  };
}

const fresh: QuoteSource = { id: 'fresh', label: '新鲜源', fetchQuotes: async () => [quote('fresh', 'A', 880, NOW - 30_000)] };
const throwing: QuoteSource = { id: 'throwing', label: '报错源', fetchQuotes: async () => { throw new Error('接口 503'); } };
const frozen: QuoteSource = {
  id: 'frozen',
  label: '陈旧源',
  fetchQuotes: async () => [quote('frozen', 'B', 870, NOW - 40 * 60_000)],
};
const brokenButEmpty: QuoteSource = { id: 'empty', label: '空返回源', fetchQuotes: async () => [] };

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

function freshStore(): QuoteStore {
  const path = join(tmpdir(), `goldsentry-health-${Math.random().toString(36).slice(2)}.json`);
  rmSync(path, { force: true });
  return new QuoteStore(path);
}

// 1) 单源正常
const s1 = freshStore();
const r1 = await pollOnce([fresh], s1, []);
check('单源正常 → ok', r1.health.status === 'ok', JSON.stringify(r1.health));
check('首轮不报故障', r1.alerts.length === 0);

// 2) 一个源挂掉 → degraded，且原因可见
const s2 = freshStore();
await pollOnce([fresh], s2, []);
const r2 = await pollOnce([fresh, throwing], s2, []);
check('部分源失败 → degraded', r2.health.status === 'degraded', r2.health.reasons.join('; '));
check('失败原因带源名和原始错误', r2.health.reasons.some((x) => x.includes('throwing') && x.includes('503')));
check('降级当场出声（新增一条 health 提醒）', r2.alerts.some((a) => a.ruleId === 'health' && a.title.includes('部分异常')));

// 3) 全部源失败 → offline
const s3 = freshStore();
await pollOnce([fresh], s3, []);
const r3 = await pollOnce([throwing, brokenButEmpty], s3, []);
check('全挂 → offline', r3.health.status === 'offline', r3.health.reasons.join('; '));
check('离线提醒文案是全部失效', r3.alerts.some((a) => a.title.includes('全部失效')));

// 4) HTTP 成功但数据冻结 → 仍判异常（这是最阴的静默失效）
const s4 = freshStore();
await pollOnce([fresh], s4, []);
const r4 = await pollOnce([fresh, frozen], s4, []);
check('返回成功但全量陈旧 → degraded', r4.health.status === 'degraded', r4.health.reasons.join('; '));
check('陈旧原因写明分钟数', r4.health.reasons.some((x) => x.includes('陈旧') && x.includes('分钟')));

// 5) 恢复时也要出声，且只在状态变化那一轮出声
const s5 = freshStore();
await pollOnce([fresh], s5, []);
await pollOnce([fresh, throwing], s5, []);
const again = await pollOnce([fresh, throwing], s5, []);
check('持续同一故障不重复提醒', again.alerts.filter((a) => a.ruleId === 'health').length === 0);
const back = await pollOnce([fresh], s5, []);
check('恢复时提醒一次', back.health.status === 'ok' && back.alerts.some((a) => a.title.includes('已恢复')));
const backAgain = await pollOnce([fresh], s5, []);
check('恢复不重复提醒', backAgain.alerts.filter((a) => a.ruleId === 'health').length === 0);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exit(failures ? 1 : 0);
