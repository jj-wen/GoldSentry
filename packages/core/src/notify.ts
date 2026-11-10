import type { FiredAlert } from './alerts.ts';

export interface BarkConfig {
  /** 自建服填自己的 https 地址，默认 https://api.day.app */
  server: string;
  deviceKey: string;
  group?: string;
  level?: 'active' | 'timeSensitive' | 'passive' | 'critical';
  sound?: string;
}

export interface BarkResult {
  ok: boolean;
  status: number;
  error?: string;
}

const STATUS_HINT: Record<number, string> = {
  400: 'Bark 参数错误',
  403: 'Bark device key 已失效（在 App 内重置后需同步更新）',
  410: 'Bark 被 APNs 拒绝',
};

function endpoint(server: string): string {
  return `${server.replace(/\/+$/, '')}/push`;
}

export async function sendBark(
  config: BarkConfig,
  payload: { title: string; body: string },
  timeoutMs = 8000,
): Promise<BarkResult> {
  if (!config.deviceKey) return { ok: false, status: 0, error: '未配置 Bark device key' };
  if (!/^https?:\/\//.test(config.server)) {
    return { ok: false, status: 0, error: 'Bark 服务器地址必须以 http(s):// 开头' };
  }

  let res: Response;
  try {
    res = await globalThis.fetch(endpoint(config.server), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_key: config.deviceKey,
        title: payload.title,
        body: payload.body,
        group: config.group ?? 'GoldSentry',
        level: config.level ?? 'active',
        ...(config.sound ? { sound: config.sound } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // 不把 deviceKey 或请求体写进错误信息，它会进日志和面板
    return { ok: false, status: 0, error: `Bark 请求失败: ${(err as Error).name}` };
  }

  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: STATUS_HINT[res.status] ?? `Bark http ${res.status}` };
}

/** 返回失败原因列表，供外壳显示——推送静默失败比不提醒更危险 */
export async function sendAlertsToBark(config: BarkConfig, alerts: FiredAlert[]): Promise<string[]> {
  const errors: string[] = [];
  for (const alert of alerts) {
    const result = await sendBark(config, { title: alert.title, body: alert.body });
    if (!result.ok && result.error) errors.push(result.error);
  }
  return errors;
}

export interface WebhookConfig {
  url: string;
}

export interface WebhookResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * 通用 Webhook：POST JSON { title, body, source, ts }。
 * URL 里可能带第三方 token（飞书/钉钉），错误信息不能回显 URL。
 */
export async function sendWebhook(
  config: WebhookConfig,
  payload: { title: string; body: string },
  timeoutMs = 8000,
): Promise<WebhookResult> {
  if (!/^https?:\/\//.test(config.url)) {
    return { ok: false, status: 0, error: 'Webhook 地址必须以 http(s):// 开头' };
  }
  let res: Response;
  try {
    res = await globalThis.fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: payload.title,
        body: payload.body,
        source: 'GoldSentry',
        ts: Date.now(),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `Webhook 请求失败: ${(err as Error).name}` };
  }
  if (res.ok) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: `Webhook http ${res.status}` };
}

export async function sendAlertsToWebhook(config: WebhookConfig, alerts: FiredAlert[]): Promise<string[]> {
  const errors: string[] = [];
  for (const alert of alerts) {
    const result = await sendWebhook(config, { title: alert.title, body: alert.body });
    if (!result.ok && result.error) errors.push(result.error);
  }
  return errors;
}
