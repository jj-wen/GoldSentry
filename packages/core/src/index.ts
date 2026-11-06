export type { Quote, QuoteSource, PriceBasis } from './types.ts';
export { ccbSource, parseAccountGoldXml } from './sources/ccb.ts';
export { jdSource, parseBatchPrice, JD_PRODUCT_SKUS } from './sources/jd.ts';
export { QuoteStore, beijingDateKey } from './store.ts';
export { evaluateRules, type AlertRule, type FiredAlert } from './alerts.ts';
export { pollOnce, type PollResult } from './poller.ts';
export { assessHealth, type HealthReport, type HealthStatus } from './health.ts';
export { feeOf, feeShortText, PRODUCT_FEES, type FeeInfo } from './fees.ts';
export { sendBark, sendAlertsToBark, type BarkConfig, type BarkResult } from './notify.ts';

import type { QuoteSource } from './types.ts';
import { ccbSource } from './sources/ccb.ts';
import { jdSource } from './sources/jd.ts';

export const sources: QuoteSource[] = [jdSource, ccbSource];
