export type { Quote, QuoteSource, PriceBasis } from './types.ts';
export { ccbSource, parseAccountGoldXml } from './sources/ccb.ts';
export { jdSource, parseBatchPrice, JD_PRODUCT_SKUS } from './sources/jd.ts';
export { QuoteStore, beijingDateKey } from './store.ts';
export { beijingDayStart, beijingHhmm } from './clock.ts';
export {
  dayTrendSeries,
  DEFAULT_TREND_SETTINGS,
  normalizeTrendRange,
  normalizeTrendSettings,
  TREND_GAP_MS,
  TREND_MAX_POINTS,
  TREND_RANGE_ORDER,
  TREND_RANGE_TEXT,
  trendSparkline,
  type SparkPoint,
  type TrendOptions,
  type TrendPoint,
  type TrendRange,
  type TrendSampleLike,
  type TrendSeries,
  type TrendSettings,
  type TrendSparkline,
} from './trend.ts';
export {
  compileRules,
  evaluateRules,
  ruleIdOf,
  ruleKindOf,
  RULE_COOLDOWN_MINUTES,
  RULE_KIND_ORDER,
  RULE_KIND_TEXT,
  RULE_KIND_UNIT,
  type AlertRule,
  type FiredAlert,
  type RuleKind,
  type RuleRow,
} from './alerts.ts';
export { pollOnce, type PollResult } from './poller.ts';
export { assessHealth, type HealthReport, type HealthStatus } from './health.ts';
export {
  bankSessionAt,
  marketSessionAt,
  tradingHoursOf,
  MARKET_SCHEDULE_AS_OF,
  type BankSession,
  type MarketSession,
  type TradingHoursInfo,
} from './market.ts';
export { feeAgeDays, feeCell, feeOf, feeShortText, FEE_STALE_DAYS, PRODUCT_FEES, type FeeCell, type FeeInfo } from './fees.ts';
export { backoffSeconds, BACKOFF_AFTER_FAILURES, BACKOFF_MAX_SECONDS } from './backoff.ts';
export { sendBark, sendAlertsToBark, type BarkConfig, type BarkResult } from './notify.ts';
export {
  applySymbolOrder,
  arrowModeOf,
  ARROW_MODE_ORDER,
  ARROW_MODE_TEXT,
  BALL_BASE_SIZE,
  BALL_SCALE_MAX,
  BALL_SCALE_MIN,
  ballSizeFor,
  clampBallScale,
  clampIntoWorkArea,
  clampOpacity,
  DEFAULT_DISPLAY,
  displayFromArrowMode,
  formatPct,
  formatPrice,
  formatQuoteCells,
  normalizeDisplay,
  normalizeSymbolOrder,
  OPACITY_MAX,
  OPACITY_MIN,
  priceTone,
  scaledSquare,
  showArrow,
  spreadCell,
  updateAgeText,
  type ArrowMode,
  type DisplayToggles,
  type PriceTone,
  type QuoteCells,
  type Rect,
  type SpreadCell,
} from './format.ts';
export {
  coversTaskbar,
  detectTaskbar,
  placeOnTaskbar,
  TASKBAR_END_MARGIN,
  type TaskbarEdge,
  type TaskbarInfo,
} from './taskbar.ts';

import type { QuoteSource } from './types.ts';
import { ccbSource } from './sources/ccb.ts';
import { jdSource } from './sources/jd.ts';

export const sources: QuoteSource[] = [jdSource, ccbSource];
