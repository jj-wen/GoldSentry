import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { beijingDateKey } from './clock.ts';
import { dayTrendSeries } from './trend.ts';
import type { TrendOptions, TrendSeries } from './trend.ts';

export { beijingDateKey } from './clock.ts';

export interface Sample {
  symbol: string;
  ts: number;
  buyPrice: number;
  sellPrice: number;
}

interface StoreShape {
  samples: Sample[];
  lastFiredAt: Record<string, number>;
  /** 规则上次求值是否为真；undefined 表示从未求值过，用于首次静默预热 */
  ruleStates: Record<string, 0 | 1>;
  healthStatus?: 'ok' | 'degraded' | 'offline';
  /** 连续「全部失效」的次数，用来决定要不要降频；一旦恢复就归零 */
  failureStreak?: number;
}

function normalizeStore(raw: unknown): StoreShape {
  const shape = (raw ?? {}) as Partial<StoreShape>;
  return {
    samples: Array.isArray(shape.samples) ? shape.samples : [],
    lastFiredAt: shape.lastFiredAt ?? {},
    ruleStates: shape.ruleStates ?? {},
    healthStatus: shape.healthStatus,
    failureStreak: shape.failureStreak ?? 0,
  };
}

const KEEP_DAYS = 10;

export class QuoteStore {
  private data: StoreShape = { samples: [], lastFiredAt: {}, ruleStates: {} };
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      this.data = normalizeStore(JSON.parse(readFileSync(filePath, 'utf8')));
    } catch {
      /* 首次运行没有文件，用空结构 */
    }
  }

  addSample(sample: Sample): void {
    this.data.samples.push(sample);
    this.prune();
    this.save();
  }

  /** 当日首笔作为基准，算相对今日开盘的涨跌幅 */
  dayChangePct(symbol: string, price: number, now: number): number | null {
    const today = beijingDateKey(now);
    const open = this.data.samples.find(
      (s) => s.symbol === symbol && beijingDateKey(s.ts) === today,
    );
    if (!open || open.buyPrice <= 0) return null;
    return ((price - open.buyPrice) / open.buyPrice) * 100;
  }

  /** 面板分时图：当日采样点与汇总；休市时可回退到最近一个有数据的自然日 */
  trend(symbol: string, now: number, options?: TrendOptions): TrendSeries {
    return dayTrendSeries(this.data.samples, symbol, now, options);
  }

  canFire(ruleId: string, now: number, cooldownMinutes: number): boolean {
    const last = this.data.lastFiredAt[ruleId];
    return last === undefined || now - last >= cooldownMinutes * 60_000;
  }

  markFired(ruleId: string, now: number): void {
    this.data.lastFiredAt[ruleId] = now;
    this.save();
  }

  /** undefined = 该规则从未求值过，首次应当静默预热而不是开局就弹 */
  lastRuleState(ruleId: string): boolean | undefined {
    const state = this.data.ruleStates[ruleId];
    return state === undefined ? undefined : state === 1;
  }

  setRuleState(ruleId: string, on: boolean): void {
    this.data.ruleStates[ruleId] = on ? 1 : 0;
    this.save();
  }

  lastHealthStatus(): 'ok' | 'degraded' | 'offline' | undefined {
    return this.data.healthStatus;
  }

  setHealthStatus(status: 'ok' | 'degraded' | 'offline'): void {
    this.data.healthStatus = status;
    this.data.failureStreak = status === 'offline' ? (this.data.failureStreak ?? 0) + 1 : 0;
    this.save();
  }

  failureStreak(): number {
    return this.data.failureStreak ?? 0;
  }

  private prune(): void {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    this.data.samples = this.data.samples.filter((s) => s.ts >= cutoff);
  }

  /** 先写临时文件再改名，避免轮询中途崩溃留下半个 JSON */
  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.filePath);
  }
}
