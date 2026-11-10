import { createHmac } from 'node:crypto';
import type { FiredAlert } from './alerts.ts';

export type BotType = 'feishu' | 'dingtalk' | 'wecom' | 'telegram';

export const BOT_TYPE_ORDER: BotType[] = ['feishu', 'dingtalk', 'wecom', 'telegram'];

export const BOT_TYPE_TEXT: Record<BotType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
  telegram: 'Telegram',
};

export function normalizeBotType(raw: unknown): BotType {
  return typeof raw === 'string' && raw in BOT_TYPE_TEXT ? (raw as BotType) : 'feishu';
}

export interface BotConfig {
  type: BotType;
  /** 飞书/钉钉/企业微信的自定义机器人地址 */
  url: string;
  /** 钉钉加签密钥，可选 */
  secret: string;
  /** Telegram bot token */
  token: string;
  /** Telegram chat id */
  chatId: string;
  /** 仅测试/代理使用，默认 Telegram 官方地址 */
  apiBase?: string;
}

export interface BotResult {
  ok: boolean;
  status: number;
  error?: string;
}

const TELEGRAM_LIMIT = 3500;
const BOT_TYPE_NAME: Record<BotType, string> = {
  feishu: '飞书',
  dingtalk: '钉钉',
  wecom: '企业微信',
  telegram: 'Telegram',
};

function networkError(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '机器人域名解析失败';
  if (code === 'ECONNREFUSED') return '机器人连接被拒绝';
  if (code === 'ETIMEDOUT') return '机器人请求超时';
  if (code?.startsWith('CERT_')) return '机器人证书校验失败';
  return `机器人请求失败：${error.name}`;
}

function signDingTalk(url: string, secret: string): string {
  const timestamp = Date.now();
  const sign = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64');
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  // 有些平台把错误码写成字符串，不能当成"没有错误码"直接放行
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

/**
 * 各家机器人载荷不同，业务错误也常常是 HTTP 200 + 非 0 错误码。
 * 地址和 token 一律不进错误信息，避免进日志或面板。
 */
export async function sendBot(
  config: BotConfig,
  payload: { title: string; body: string },
  timeoutMs = 8000,
): Promise<BotResult> {
  const type = normalizeBotType(config.type);
  const name = BOT_TYPE_NAME[type];
  const text = `${payload.title}\n${payload.body}`;
  let url: string;
  let body: unknown;

  if (type === 'telegram') {
    const token = config.token.trim();
    const chatId = config.chatId.trim();
    if (!token) return { ok: false, status: 0, error: '未配置 Telegram bot token' };
    if (!chatId) return { ok: false, status: 0, error: '未配置 Telegram chat id' };
    const base = (config.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '');
    url = `${base}/bot${token}/sendMessage`;
    body = {
      chat_id: chatId,
      text: text.length > TELEGRAM_LIMIT ? `${text.slice(0, TELEGRAM_LIMIT)}…` : text,
      disable_web_page_preview: true,
    };
  } else {
    const raw = config.url.trim();
    if (!raw) return { ok: false, status: 0, error: `未配置${name}机器人地址` };
    if (!/^https?:\/\//.test(raw)) return { ok: false, status: 0, error: '机器人地址必须以 http(s):// 开头' };
    url = type === 'dingtalk' && config.secret.trim() ? signDingTalk(raw, config.secret.trim()) : raw;
    if (type === 'feishu') body = { msg_type: 'text', content: { text } };
    else body = { msgtype: 'text', text: { content: text } };
  }

  let res: Response;
  try {
    res = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ok: false, status: 0, error: networkError(error as Error) };
  }

  let data: Record<string, unknown> | null = null;
  try {
    data = asRecord(await res.json());
  } catch {
    data = null;
  }

  if (!res.ok) return { ok: false, status: res.status, error: `${name} http ${res.status}` };

  if (type === 'telegram') {
    if (data?.ok === true) return { ok: true, status: res.status };
    const description = typeof data?.description === 'string' ? data.description.replace(config.token, '***') : '未知错误';
    return { ok: false, status: res.status, error: `Telegram 返回：${description}` };
  }

  if (type === 'feishu') {
    const code = numeric(data?.code) ?? numeric(data?.StatusCode);
    if (code === null || code === 0) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `飞书返回错误码 ${code}` };
  }

  const errcode = numeric(data?.errcode);
  if (errcode === null || errcode === 0) return { ok: true, status: res.status };
  return { ok: false, status: res.status, error: `${name}返回错误码 ${errcode}` };
}

export async function sendAlertsToBot(
  config: BotConfig,
  alerts: ReadonlyArray<FiredAlert>,
  timeoutMs = 8000,
): Promise<string[]> {
  const errors: string[] = [];
  for (const alert of alerts) {
    const result = await sendBot(config, { title: alert.title, body: alert.body }, timeoutMs);
    if (!result.ok && result.error) errors.push(result.error);
  }
  return errors;
}
