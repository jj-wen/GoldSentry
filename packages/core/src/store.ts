import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { beijingDateKey } from './clock.ts';
import { dayTrendSeries } from './trend.ts';
import type { TrendOptions, TrendSeries } from './trend.ts';
import { buildDailyDigest } from './digest.ts';
import type { DailyDigest, DigestOptions } from './digest.ts';

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
  /** 最近一次已发送简报的交易日，避免重启后重复推送 */
  lastDigestDay?: string;
}

function normalizeStore(raw: unknown): StoreShape {
  const shape = (raw ?? {}) as Partial<StoreShape>;
  return {
    samples: Array.isArray(shape.samples) ? shape.samples : [],
    lastFiredAt: shape.lastFiredAt ?? {},
    ruleStates: shape.ruleStates ?? {},
    healthStatus: shape.healthStatus,
    failureStreak: shape.failureStreak ?? 0,
    lastDigestDay: typeof shape.lastDigestDay === 'string' ? shape.lastDigestDay : undefined,
  };
}

const KEEP_DAYS = 10;
/** 采样盘最多每分钟写一次：文件会涨到十几 MB，每轮轮询都重写会拖慢主进程 */
const SAMPLE_SAVE_INTERVAL_MS = 60_000;

export class QuoteStore {
  private data: StoreShape = { samples: [], lastFiredAt: {}, ruleStates: {} };
  private filePath: string;
  private dirty = false;
  private lastSaveAt = 0;
  /** 每个品种最后一笔采样：时间戳和买卖价都没变就不重复入库（休市时尤其多） */
  private lastSample = new Map<string, Sample>();

  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      this.data = normalizeStore(JSON.parse(readFileSync(filePath, 'utf8')));
    } catch {
      /* 首次运行没有文件，用空结构 */
    }
    this.indexLastSample();
  }

  addSample(sample: Sample): void {
    this.addSamples([sample]);
  }

  /** 一轮取数只推一次、只裁一次、最多写一次 */
  addSamples(samples: Sample[]): void {
    const fresh: Sample[] = [];
    for (const sample of samples) {
      const previous = this.lastSample.get(sample.symbol);
      if (
        previous &&
        previous.ts === sample.ts &&
        previous.buyPrice === sample.buyPrice &&
        previous.sellPrice === sample.sellPrice
      ) {
        continue;
      }
      this.lastSample.set(sample.symbol, sample);
      fresh.push(sample);
    }
    if (!fresh.length) return;
    this.data.samples.push(...fresh);
    this.prune();
    this.dirty = true;
    this.saveIfDue();
  }

  /** 退出前调用，补写还没落盘的采样 */
  flush(): void {
    if (this.dirty) this.save();
  }

  /** 品种下线后清掉历史采样，避免旧数据一直撑大文件 */
  retainSymbols(symbols: string[]): void {
    const allowed = new Set(symbols);
    const before = this.data.samples.length;
    this.data.samples = this.data.samples.filter((sample) => allowed.has(sample.symbol));
    if (this.data.samples.length !== before) {
      this.indexLastSample();
      this.save();
    }
  }

  private indexLastSample(): void {
    this.lastSample = new Map();
    for (const sample of this.data.samples) {
      const previous = this.lastSample.get(sample.symbol);
      if (!previous || sample.ts >= previous.ts) this.lastSample.set(sample.symbol, sample);
    }
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

  /** 最近一个已结束交易日的简报；没有采样时返回 null */
  digest(now: number, labels: Record<string, string>, options?: DigestOptions): DailyDigest | null {
    return buildDailyDigest(this.data.samples, labels, now, options);
  }

  lastDigestDay(): string | undefined {
    return this.data.lastDigestDay;
  }

  setLastDigestDay(day: string): void {
    if (this.data.lastDigestDay === day) return;
    this.data.lastDigestDay = day;
    this.save();
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
    const streak = status === 'offline' ? (this.data.failureStreak ?? 0) + 1 : 0;
    const statusChanged = this.data.healthStatus !== status;
    this.data.healthStatus = status;
    this.data.failureStreak = streak;
    // 只有连续失效次数在变时不必每轮重写大盘，跟着采样限频落盘即可
    if (statusChanged) this.save();
    else {
      this.dirty = true;
      this.saveIfDue();
    }
  }

  failureStreak(): number {
    return this.data.failureStreak ?? 0;
  }

  private prune(): void {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    this.data.samples = this.data.samples.filter((s) => s.ts >= cutoff);
  }

  /** 先写临时文件再改名，避免轮询中途崩溃留下半个 JSON；临时文件按进程区分，两个实例同时写也不会互相截断 */
  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.filePath);
    this.dirty = false;
    this.lastSaveAt = Date.now();
  }

  private saveIfDue(): void {
    if (!this.dirty) return;
    if (Date.now() - this.lastSaveAt < SAMPLE_SAVE_INTERVAL_MS) return;
    this.save();
  }
}
