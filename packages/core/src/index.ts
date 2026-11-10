export type { Quote, QuoteSource, PriceBasis } from './types.ts';
export { jdSource, parseBatchPrice, JD_PRODUCT_SKUS, JD_SYMBOLS } from './sources/jd.ts';
export { QuoteStore, beijingDateKey } from './store.ts';
export { beijingDayStart, beijingHhmm, beijingMinutes } from './clock.ts';
export { buildDailyDigest, type DailyDigest, type DigestOptions } from './digest.ts';
export { inQuietHours, parseHhmm, timeReached, type QuietHours } from './schedule.ts';
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
  evaluatePortfolioRules,
  evaluateRules,
  isPortfolioKind,
  PORTFOLIO_SYMBOL,
  ruleIdOf,
  ruleKindOf,
  ruleValueOf,
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
  tradingDayKey,
  tradingHoursOf,
  MARKET_SCHEDULE_AS_OF,
  type BankSession,
  type MarketSession,
  type TradingHoursInfo,
} from './market.ts';
export { feeAgeDays, feeCell, feeOf, feeShortText, FEE_STALE_DAYS, PRODUCT_FEES, type FeeCell, type FeeInfo } from './fees.ts';
export { backoffSeconds, BACKOFF_AFTER_FAILURES, BACKOFF_MAX_SECONDS } from './backoff.ts';
export { sendBark, sendAlertsToBark, sendWebhook, sendAlertsToWebhook, type BarkConfig, type BarkResult, type WebhookConfig, type WebhookResult } from './notify.ts';
export { sendMail, sendAlertsToMail, type MailConfig, type MailResult } from './mail.ts';
export {
  BOT_TYPE_ORDER,
  BOT_TYPE_TEXT,
  normalizeBotType,
  sendAlertsToBot,
  sendBot,
  type BotConfig,
  type BotResult,
  type BotType,
} from './bot.ts';
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
export {
  calcAmount,
  calcDeleteError,
  calcEstimate,
  calcEstimateText,
  calcLedger,
  calcLedgersBySymbol,
  calcSelection,
  dailyPortfolio,
  formatGrams,
  isCalcDate,
  normalizeCalcRecords,
  portfolioSummary,
  type CalcEstimate,
  type CalcLedger,
  type CalcRecord,
  type CalcSelection,
  type CalcSide,
  type DailyPortfolio,
  type PortfolioPosition,
  type PortfolioSummary,
  type SymbolLedger,
} from './calculator.ts';

import type { QuoteSource } from './types.ts';
import { jdSource } from './sources/jd.ts';

export const sources: QuoteSource[] = [jdSource];
