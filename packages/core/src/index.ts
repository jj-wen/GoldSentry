export type { Quote, QuoteSource, PriceBasis } from './types.ts';
export { ccbSource, parseAccountGoldXml } from './sources/ccb.ts';
export { jdSource, parseBatchPrice, JD_PRODUCT_SKUS } from './sources/jd.ts';
export { QuoteStore, beijingDateKey } from './store.ts';
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
export { feeOf, feeShortText, PRODUCT_FEES, type FeeInfo } from './fees.ts';
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
  type ArrowMode,
  type DisplayToggles,
  type PriceTone,
  type QuoteCells,
  type Rect,
  type SpreadCell,
} from './format.ts';
export {
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
