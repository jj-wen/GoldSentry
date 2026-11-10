import type { Quote, QuoteSource } from './types.ts';
import { bankSessionAt, marketSessionAt } from './market.ts';

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

  const session = marketSessionAt(now);
  const market = { marketClosed: !session.open, closedReason: session.reason };

  // 休市期间银行的行情服务本来就可能取不到数据或返回空，属于预期行为：
  // 不判异常、不发通知，等开市后仍取不到再报
  if (!session.open) return { status: 'ok', reasons: [], ...market };

  for (const error of errors) reasons.push(error);

  // 开市期间的旧报价/冻结才可能是静默失效；收盘银行的报价不动是预期
  const alive = new Set(quotes.map((q) => q.sourceId));
  for (const source of sources) {
    if (!alive.has(source.id)) continue;
    const mine = quotes.filter((q) => q.sourceId === source.id && bankSessionAt(q.symbol, now).open);
    if (!mine.length) continue;
    const stale = mine.filter((q) => isStale(q, now));
    if (stale.length === mine.length) {
      reasons.push(`${source.id} 返回成功但全部报价陈旧（最久 ${Math.round(Math.max(...stale.map((q) => now - q.quotedAt)) / 60000)} 分钟未更新）`);
    }
  }

  if (quotes.length === 0) return { status: 'offline', reasons: reasons.length ? reasons : ['没有任何可用报价'], ...market };
  if (reasons.length) return { status: 'degraded', reasons, ...market };
  return { status: 'ok', reasons: [], ...market };
}
