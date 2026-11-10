import type { Quote, QuoteSource } from './types.ts';
import type { QuoteStore } from './store.ts';
import { evaluateRules, type AlertRule, type FiredAlert } from './alerts.ts';
import { assessHealth, type HealthReport, type HealthStatus } from './health.ts';

export interface PollResult {
  quotes: Quote[];
  alerts: FiredAlert[];
  errors: string[];
  health: HealthReport;
  /** 连续全部失效次数，外壳用 backoffSeconds 决定下一轮间隔 */
  failureStreak: number;
}

function transitionAlert(from: HealthStatus, health: HealthReport): FiredAlert {
  if (health.status === 'ok') {
    return {
      ruleId: 'health',
      symbol: '-',
      title: 'GoldSentry 数据源已恢复',
      body: `此前状态：${from === 'offline' ? '全部失效' : '部分异常'}`,
    };
  }
  return {
    ruleId: 'health',
    symbol: '-',
    title: health.status === 'offline' ? 'GoldSentry 数据源全部失效' : 'GoldSentry 数据源部分异常',
    body: health.reasons.join('；') || '状态从正常变为异常',
  };
}

/** 外壳只需要按间隔调用它，落样本、算提醒、判健康都在 core 内 */
export async function pollOnce(
  sources: QuoteSource[],
  store: QuoteStore,
  rules: AlertRule[],
  now = Date.now(),
): Promise<PollResult> {
  const quotes: Quote[] = [];
  const alerts: FiredAlert[] = [];
  const errors: string[] = [];

  for (const source of sources) {
    let fetched: Quote[];
    try {
      fetched = await source.fetchQuotes();
    } catch (err) {
      errors.push(`${source.id}: ${(err as Error).message}`);
      continue;
    }

    // 一轮的所有报价一起入库，避免每个品种各写一次大文件
    store.addSamples(
      fetched.map((quote) => ({
        symbol: quote.symbol,
        ts: quote.quotedAt,
        buyPrice: quote.buyPrice,
        sellPrice: quote.sellPrice,
      })),
    );
    for (const quote of fetched) {
      // 数据源不给昨收时用本地当日首笔补齐，让所有端都能显示涨跌幅
      if (quote.dayChangePct === undefined || !Number.isFinite(quote.dayChangePct)) {
        quote.dayChangePct = store.dayChangePct(quote.symbol, quote.buyPrice, now) ?? undefined;
      }
      quotes.push(quote);
      alerts.push(...evaluateRules(rules, quote, store, now));
    }
  }

  const health = assessHealth(sources, quotes, errors, now);
  const previous = store.lastHealthStatus();
  // 首轮只记录基线，避免刚启动就报故障
  if (previous !== undefined && health.status !== previous) alerts.push(transitionAlert(previous, health));
  store.setHealthStatus(health.status);

  return { quotes, alerts, errors, health, failureStreak: store.failureStreak() };
}
