import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { BACKOFF_AFTER_FAILURES, BACKOFF_MAX_SECONDS, backoffSeconds, QuoteStore, pollOnce as rawPollOnce, type Quote, type QuoteSource } from '../packages/core/src/index.ts';

/** 固定成周五 10:00 北京时间：否则周末/节假日跑测试会把"陈旧"断言误判成正常 */
const NOW = Date.parse('2026-11-06T02:00:00Z');
/** 周日 12:00 北京时间，用于休市场景 */
const SUNDAY_NOON = Date.parse('2026-11-08T04:00:00Z');

/** 既有断言全部按开市时段跑；休市场景显式传时间用 rawPollOnce */
const pollOnce = (sources: QuoteSource[], store: QuoteStore, rules: Parameters<typeof rawPollOnce>[2]) =>
  rawPollOnce(sources, store, rules, NOW);

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

// 6) 连续全部失效才降频，恢复立刻回到设定值
check('未达阈值不降频', backoffSeconds(30, BACKOFF_AFTER_FAILURES - 1) === 30);
check('达到阈值翻一倍', backoffSeconds(30, BACKOFF_AFTER_FAILURES) === 60);
check('继续失效按 2 的幂拉长', backoffSeconds(30, BACKOFF_AFTER_FAILURES + 1) === 120 && backoffSeconds(30, BACKOFF_AFTER_FAILURES + 2) === 240);
check('拉长有上限', backoffSeconds(30, 50) === BACKOFF_MAX_SECONDS);
check('小间隔不会被上限吃掉', backoffSeconds(1, BACKOFF_AFTER_FAILURES) === 2);
check('用户本来就设 5 分钟时不再拉长', backoffSeconds(300, BACKOFF_AFTER_FAILURES) === 300);
check('用户设 10 分钟时降频不会反而调快', backoffSeconds(600, BACKOFF_AFTER_FAILURES) === 600 && backoffSeconds(600, 50) === 600);
check('脏间隔退回默认而不是 NaN', backoffSeconds(Number.NaN, 0) === 30 && backoffSeconds(0, 0) === 30);
check('脏失败次数不降频', backoffSeconds(30, Number.NaN) === 30);

const s6 = freshStore();
await pollOnce([fresh], s6, []);
const off1 = await pollOnce([throwing], s6, []);
const off2 = await pollOnce([throwing], s6, []);
const off3 = await pollOnce([throwing], s6, []);
check('offline 逐轮累加失效次数', off1.failureStreak === 1 && off2.failureStreak === 2 && off3.failureStreak === 3, `${off1.failureStreak}/${off2.failureStreak}/${off3.failureStreak}`);
check('第三轮才真的降频', backoffSeconds(30, off2.failureStreak) === 30 && backoffSeconds(30, off3.failureStreak) === 60);
const partial = await pollOnce([fresh, throwing], s6, []);
check('部分异常不算连续失效（还有源在出数）', partial.health.status === 'degraded' && partial.failureStreak === 0);
await pollOnce([throwing], s6, []);
const recovered = await pollOnce([fresh], s6, []);
check('恢复后失效次数归零', recovered.health.status === 'ok' && recovered.failureStreak === 0);
check('恢复后间隔回到用户设定值', backoffSeconds(30, recovered.failureStreak) === 30);

const s7Path = join(tmpdir(), `goldsentry-health-${Math.random().toString(36).slice(2)}.json`);
rmSync(s7Path, { force: true });
const s7 = new QuoteStore(s7Path);
await pollOnce([throwing], s7, []);
await pollOnce([throwing], s7, []);
const reloaded = new QuoteStore(s7Path);
check('失效次数落盘，重启后接着算', reloaded.failureStreak() === 2, String(reloaded.failureStreak()));

// 7) 休市：报价冻结是预期，不能报"全部陈旧"；真故障仍要报
const s8 = freshStore();
const closedOk = await rawPollOnce([fresh], s8, [], SUNDAY_NOON);
check('周末休市 → 健康仍为 ok（不误报陈旧）', closedOk.health.status === 'ok', JSON.stringify(closedOk.health));
check('健康报告带休市标记与原因', closedOk.health.marketClosed === true && closedOk.health.closedReason === '周末休市', closedOk.health.closedReason);
check('休市不产生故障提醒', closedOk.alerts.filter((a) => a.ruleId === 'health').length === 0);

const s9 = freshStore();
const closedBroken = await rawPollOnce([throwing], s9, [], SUNDAY_NOON);
check('休市期间真故障仍判 offline', closedBroken.health.status === 'offline' && closedBroken.health.reasons.length > 0, closedBroken.health.reasons.join('; '));
check('故障期间休市标记仍在', closedBroken.health.marketClosed === true);

const s10 = freshStore();
await rawPollOnce([fresh], s10, [], SUNDAY_NOON);
const reopened = await rawPollOnce([fresh], s10, [], NOW);
check('开市后回到正常判定路径', reopened.health.status === 'ok' && reopened.health.marketClosed === false);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
