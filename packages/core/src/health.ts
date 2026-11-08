import type { Quote, QuoteSource } from './types.ts';
import { marketSessionAt } from './market.ts';

export type HealthStatus = 'ok' | 'degraded' | 'offline';

export interface HealthReport {
  status: HealthStatus;
  reasons: string[];
  /** 休市期间报价本来就不动，陈旧不算故障；外壳据此显示"休市"而不是"部分异常" */
  marketClosed: boolean;
  closedReason: string;
}

/** 实时源超过这个年龄就没动过，视为失效；日定价源按天算 */
const REALTIME_STALE_MS = 5 * 60_000;
const DAILY_FIX_STALE_MS = 20 * 3_600_000;

function isStale(quote: Quote, now: number): boolean {
  const limit = quote.basis === 'dailyFix' ? DAILY_FIX_STALE_MS : REALTIME_STALE_MS;
  return !Number.isFinite(quote.quotedAt) || now - quote.quotedAt > limit;
}

export function assessHealth(
  sources: QuoteSource[],
  quotes: Quote[],
  errors: string[],
  now = Date.now(),
): HealthReport {
  const reasons: string[] = [];

  for (const error of errors) reasons.push(error);

  const session = marketSessionAt(now);
  // 休市（周末/节假日/开市前）报价冻结是预期行为，只有开市期间的冻结才是静默失效
  if (session.open) {
    const alive = new Set(quotes.map((q) => q.sourceId));
    for (const source of sources) {
      if (!alive.has(source.id)) continue;
      const mine = quotes.filter((q) => q.sourceId === source.id);
      const stale = mine.filter((q) => isStale(q, now));
      if (stale.length === mine.length && mine.length > 0) {
        reasons.push(`${source.id} 返回成功但全部报价陈旧（最久 ${Math.round(Math.max(...stale.map((q) => now - q.quotedAt)) / 60000)} 分钟未更新）`);
      }
    }
  }

  const market = { marketClosed: !session.open, closedReason: session.reason };
  if (quotes.length === 0) return { status: 'offline', reasons: reasons.length ? reasons : ['没有任何可用报价'], ...market };
  if (reasons.length) return { status: 'degraded', reasons, ...market };
  return { status: 'ok', reasons: [], ...market };
}
