/**
 * 积存金交易时段（北京时间）。银行积存金是连续盘：日盘 9:00–15:30 直接接夜盘到次日凌晨，
 * 各家收盘点不同（实测 2026-11-07 收盘时间戳：工商 22:30、广发/兴业/中信/民生 02:00、浙商 02:30），
 * 这里取并集 09:00 → 次日 02:30。并集内只要还有一家开着，源级"全量陈旧"判定就不会误报。
 * 节假日本身无法从星期推出来，只能维护公告表：来源与核对日期见 docs/DATA-SOURCES.md，每年更新一次。
 */

/** 最近一次核对休市公告的日期；跨年之前必须重新核对 */
export const MARKET_SCHEDULE_AS_OF = '2026-11-08';

/** 节假日整段休市；区间里的周末本来就休市，写全是为了和公告原文逐字对得上 */
const HOLIDAY_RANGES: Array<[string, string, string]> = [
  ['2026-01-01', '2026-01-03', '元旦'],
  ['2026-02-15', '2026-02-23', '春节'],
  ['2026-04-04', '2026-04-06', '清明'],
  ['2026-05-01', '2026-05-05', '劳动节'],
  ['2026-06-19', '2026-06-21', '端午'],
  ['2026-09-25', '2026-09-27', '中秋'],
  ['2026-10-01', '2026-10-07', '国庆'],
];

/** 节假日前最后一个交易日晚上不进行夜盘交易（公告原文逐条列出） */
const NO_NIGHT_EVENINGS = new Set([
  '2025-12-31',
  '2026-02-13',
  '2026-04-03',
  '2026-04-30',
  '2026-06-18',
  '2026-09-24',
  '2026-09-30',
]);

const DAY_OPEN = 9 * 60;
const DAY_CLOSE = 15 * 60 + 30;
/** 夜盘最晚收盘点（浙商 02:30），凌晨这段属于前一日夜盘 */
const NIGHT_END = 2 * 60 + 30;

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function beijingParts(now: number): { dateKey: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date(now));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_NAMES.indexOf(get('weekday')),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function holidayOf(dateKey: string): string | undefined {
  return HOLIDAY_RANGES.find(([from, to]) => dateKey >= from && dateKey <= to)?.[2];
}

function prevDateKey(dateKey: string): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function closedReason(dateKey: string, weekday: number, noNight: boolean): string {
  const holiday = holidayOf(dateKey);
  if (holiday) return `${holiday}休市`;
  if (weekday === 0 || weekday === 6) return '周末休市';
  if (noNight) return '节前夜盘暂停';
  return '开市前（09:00 开市）';
}

export interface MarketSession {
  open: boolean;
  /** 休市原因，开市时为空串 */
  reason: string;
}

export interface TradingHoursInfo {
  /** 展示用的时段文案，如「周一 09:00–周六 02:00」 */
  text: string;
  /** 开盘点，0–1440 分钟 */
  openMinutes: number;
  /** 收盘点；凌晨收盘写成 0–1440 内的分钟数 */
  closeMinutes: number;
  /** 开盘时刻文案，用于「开市前（09:10 开市）」 */
  openText: string;
  /** 收盘时刻文案，用于「已收盘（22:30）」 */
  closeText: string;
  /** 与积存金并集时段无关的品种（建行账户金） */
  continuous?: boolean;
  /** 规则说明，直接给详情面板/VS Code hover */
  note: string;
}

/** 交易日：周一至周五且不在休市公告里；调休补班的周末仍按周末休市 */
function isTradingDay(dateKey: string, weekday: number): boolean {
  return weekday >= 1 && weekday <= 5 && !holidayOf(dateKey);
}

/**
 * 各家时段来自京东产品页的 goldPriceQuoteTimePeriodList + 本地 quotes.json 实测收盘点：
 * 工商 09:10–22:30；浙商 周一 09:00–周六 02:30；民生 09:10–次日 02:00；
 * 广发/兴业/中信 09:00–次日 02:00；建行积存 周一 09:10–周六 02:30。
 * 京东对浙商写 00:00–23:59、对广发写 15:30–20:00 停盘，但实测报价分别到 02:30、且午后连续，
 * 以实测为准；周末和法定节假日统一休市。
 */
const TRADING_HOURS: Record<string, TradingHoursInfo> = {
  GS: {
    text: '周一 09:10–周五 22:30',
    openMinutes: 9 * 60 + 10,
    closeMinutes: 22 * 60 + 30,
    openText: '09:10',
    closeText: '22:30',
    note: '工商积存金 09:10 开市、22:30 收盘；周末与法定节假日休市，节前最后交易日晚上停夜盘',
  },
  ZS: {
    text: '周一 09:00–周六 02:30',
    openMinutes: 9 * 60,
    closeMinutes: 2 * 60 + 30,
    openText: '09:00',
    closeText: '次日 02:30',
    note: '浙商积存金周一 09:00 开市、周六 02:30 收盘；周末与法定节假日休市，节前最后交易日晚上停夜盘',
  },
  MS: {
    text: '周一 09:10–周六 02:00',
    openMinutes: 9 * 60 + 10,
    closeMinutes: 2 * 60,
    openText: '09:10',
    closeText: '次日 02:00',
    note: '民生积存金 09:10 开市、次日 02:00 收盘；周末与法定节假日休市，节前最后交易日晚上停夜盘',
  },
  GF: {
    text: '周一 09:00–周六 02:00',
    openMinutes: 9 * 60,
    closeMinutes: 2 * 60,
    openText: '09:00',
    closeText: '次日 02:00',
    note: '广发积存金 09:00 开市、次日 02:00 收盘；实测午后不中断，周末与法定节假日休市',
  },
  XY: {
    text: '周一 09:00–周六 02:00',
    openMinutes: 9 * 60,
    closeMinutes: 2 * 60,
    openText: '09:00',
    closeText: '次日 02:00',
    note: '兴业积存金 09:00 开市、次日 02:00 收盘；周末与法定节假日休市，节前最后交易日晚上停夜盘',
  },
  ZX: {
    text: '周一 09:00–周六 02:00',
    openMinutes: 9 * 60,
    closeMinutes: 2 * 60,
    openText: '09:00',
    closeText: '次日 02:00',
    note: '中信积存金 09:00 开市、次日 02:00 收盘；周末与法定节假日休市，节前最后交易日晚上停夜盘',
  },
  JJC: {
    text: '周一 09:10–周六 02:30',
    openMinutes: 9 * 60 + 10,
    closeMinutes: 2 * 60 + 30,
    openText: '09:10',
    closeText: '次日 02:30',
    note: '建行黄金积存周一 09:10 至周六 02:30；主动积存价每日 10:30 定价，赎回价盘中更新',
  },
  AU9999: {
    text: '连续盘（以建行 App 为准）',
    openMinutes: 0,
    closeMinutes: 24 * 60,
    openText: '以建行 App 为准',
    closeText: '以建行 App 为准',
    continuous: true,
    note: '建行账户金不受积存金并集时段约束，具体交易时间以建行 App 为准',
  },
  AU9995: {
    text: '连续盘（以建行 App 为准）',
    openMinutes: 0,
    closeMinutes: 24 * 60,
    openText: '以建行 App 为准',
    closeText: '以建行 App 为准',
    continuous: true,
    note: '建行账户金不受积存金并集时段约束，具体交易时间以建行 App 为准',
  },
};

export function tradingHoursOf(symbol: string): TradingHoursInfo | undefined {
  return TRADING_HOURS[symbol];
}

export interface BankSession {
  open: boolean;
  /** 开市中 / 未开盘 / 已收盘 / 休市 / 连续盘 */
  text: string;
  /** 休市或收盘原因，开市时为空串 */
  reason: string;
}

/**
 * 单家银行的交易状态。按「今天/昨天是不是交易日 + 该行开盘/收盘点」判断，
 * 凌晨 00:00–02:30 属于前一交易日夜盘；工商 22:30 收盘后市场并集仍开着，
 * 所以不能直接用 marketSessionAt。
 */
export function bankSessionAt(symbol: string, now = Date.now()): BankSession {
  const hours = tradingHoursOf(symbol);
  const { dateKey, weekday, minutes } = beijingParts(now);
  if (!hours) {
    const base = marketSessionAt(now);
    return { open: base.open, text: base.open ? '开市中' : '休市', reason: base.reason };
  }
  if (hours.continuous) {
    const base = marketSessionAt(now);
    return { open: base.open, text: base.open ? '连续盘' : '休市', reason: base.reason };
  }

  const todayTrading = isTradingDay(dateKey, weekday);
  const prev = prevDateKey(dateKey);
  const prevWeekday = (weekday + 6) % 7;
  const prevTrading = isTradingDay(prev, prevWeekday);
  // 收盘点小于开盘点表示跨到次日凌晨，例如 09:00–02:00 记成 09:00–1560
  const endMinutes = hours.closeMinutes <= hours.openMinutes ? hours.closeMinutes + 1440 : hours.closeMinutes;
  const todayOpen =
    todayTrading &&
    minutes >= hours.openMinutes &&
    minutes < endMinutes &&
    !(NO_NIGHT_EVENINGS.has(dateKey) && minutes >= DAY_CLOSE);
  const overnightOpen =
    prevTrading &&
    !holidayOf(dateKey) &&
    minutes < NIGHT_END &&
    minutes + 1440 >= hours.openMinutes &&
    minutes + 1440 < endMinutes &&
    !NO_NIGHT_EVENINGS.has(prev);
  if (todayOpen || overnightOpen) return { open: true, text: '开市中', reason: '' };

  if (todayTrading && NO_NIGHT_EVENINGS.has(dateKey) && minutes >= DAY_CLOSE) {
    return { open: false, text: '已收盘', reason: '节前夜盘暂停' };
  }
  if (!todayTrading) {
    return { open: false, text: '休市', reason: closedReason(dateKey, weekday, false) };
  }
  if (minutes < hours.openMinutes) {
    return { open: false, text: '未开盘', reason: `开市前（${hours.openText} 开市）` };
  }
  return { open: false, text: '已收盘', reason: `已收盘（${hours.closeText}）` };
}

export function marketSessionAt(now = Date.now()): MarketSession {
  const { dateKey, weekday, minutes } = beijingParts(now);
  if (minutes < NIGHT_END) {
    const prev = prevDateKey(dateKey);
    const prevWeekday = (weekday + 6) % 7;
    const prevIsWorkday = prevWeekday >= 1 && prevWeekday <= 5;
    if (prevIsWorkday && !holidayOf(prev) && !NO_NIGHT_EVENINGS.has(prev)) return { open: true, reason: '' };
    return { open: false, reason: closedReason(prev, prevWeekday, NO_NIGHT_EVENINGS.has(prev)) };
  }
  if (minutes < DAY_OPEN) return { open: false, reason: closedReason(dateKey, weekday, false) };
  if (holidayOf(dateKey)) return { open: false, reason: `${holidayOf(dateKey)}休市` };
  // 调休补班的周末对办公室是工作日，对市场仍是休市，周末规则已经覆盖
  if (weekday === 0 || weekday === 6) return { open: false, reason: '周末休市' };
  if (minutes < DAY_CLOSE) return { open: true, reason: '' };
  if (NO_NIGHT_EVENINGS.has(dateKey)) return { open: false, reason: '节前夜盘暂停' };
  return { open: true, reason: '' };
}