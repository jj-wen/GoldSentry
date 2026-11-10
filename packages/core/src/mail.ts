import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomUUID } from 'node:crypto';
import type { FiredAlert } from './alerts.ts';

export interface MailConfig {
  host: string;
  port: number;
  /** true 走 465 隐式 TLS；false 走 25/587，服务器支持时自动 STARTTLS */
  secure: boolean;
  /** 留空表示不认证，只适合本机/内网中继 */
  user: string;
  pass: string;
  /** 留空时用 user */
  from: string;
  /** 多个收件人用逗号/分号/空格分隔 */
  to: string;
}

export interface MailResult {
  ok: boolean;
  /** SMTP 应答码；连接失败为 0 */
  status: number;
  error?: string;
}

interface Reply {
  code: number;
  lines: string[];
}

class SmtpError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * 按 SMTP 应答边界解析多行回复：`250-` 是续行，`250 ` 才是结束。
 * 服务器偶尔会在应答间插入非协议行，直接跳过。
 */
class ReplyReader {
  private buffer = '';
  private waiters: Array<{ resolve: (reply: Reply) => void; reject: (error: Error) => void }> = [];
  private failure: Error | null = null;
  private socket: Socket;
  private onData: (chunk: string) => void;
  private onError: (error: Error) => void;
  private onClose: () => void;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    this.onData = (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    };
    this.onError = (error: Error) => {
      this.failure ??= error;
      this.drain();
    };
    this.onClose = () => {
      this.failure ??= new Error('SMTP 连接已关闭');
      this.drain();
    };
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
  }

  read(): Promise<Reply> {
    const reply = this.takeReply();
    if (reply) return Promise.resolve(reply);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<Reply>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  detach(): void {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
  }

  private drain(): void {
    while (this.waiters.length) {
      const reply = this.takeReply();
      if (reply) {
        this.waiters.shift()?.resolve(reply);
        continue;
      }
      if (this.failure) {
        this.waiters.shift()?.reject(this.failure);
        continue;
      }
      break;
    }
  }

  private takeReply(): Reply | null {
    let index = 0;
    let code = 0;
    const lines: string[] = [];
    for (;;) {
      const end = this.buffer.indexOf('\r\n', index);
      if (end < 0) return null;
      const line = this.buffer.slice(index, end);
      index = end + 2;
      const match = /^(\d{3})([ -]|$)/.exec(line);
      if (!match) continue;
      lines.push(line);
      if (match[2] !== '-') {
        code = Number(match[1]);
        break;
      }
    }
    this.buffer = this.buffer.slice(index);
    return { code, lines };
  }
}

function smtpErrorMessage(code: number, step: string): string {
  if (code === 535 || code === 534) return 'SMTP 认证失败，请检查账号与授权码（535）';
  if (code === 530) return 'SMTP 服务器要求先认证（530）';
  if (code === 550 || code === 551 || code === 553) return `SMTP 拒绝${step}（${code}）`;
  if (code === 421) return 'SMTP 服务器拒绝服务（421），稍后再试';
  if (code >= 400 && code < 500) return `SMTP 临时失败（${code}）：${step}`;
  return `SMTP ${step}失败（${code}）`;
}

function networkMessage(error: Error): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'SMTP 域名解析失败，检查服务器地址';
  if (code === 'ECONNREFUSED') return 'SMTP 连接被拒绝，检查地址与端口';
  if (code === 'ETIMEDOUT') return 'SMTP 连接超时';
  if (code?.startsWith('CERT_') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'SMTP 证书校验失败';
  }
  return `SMTP 连接失败：${error.message}`;
}

async function expectReply(
  reader: ReplyReader,
  socket: Socket,
  line: string | null,
  codes: number[],
  step: string,
): Promise<Reply> {
  if (line !== null) socket.write(`${line}\r\n`);
  const reply = await reader.read();
  if (!codes.includes(reply.code)) throw new SmtpError(reply.code, smtpErrorMessage(reply.code, step));
  return reply;
}

/** SNI 不能填 IP 字面量（RFC 6066），测试桩和纯 IP 的邮件中继都会因此报警 */
function servernameOf(host: string): string | undefined {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':') ? undefined : host;
}

function connectSocket(config: MailConfig, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tlsConnect({ host: config.host, port: config.port, servername: servernameOf(config.host) })
      : netConnect({ host: config.host, port: config.port });
    const onReady = () => {
      socket.off('error', onError);
      resolve(socket);
    };
    const onError = (error: Error) => {
      socket.off(config.secure ? 'secureConnect' : 'connect', onReady);
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(timeoutMs, () => socket.destroy(new Error('SMTP 超时')));
    socket.once('error', onError);
    socket.once(config.secure ? 'secureConnect' : 'connect', onReady);
  });
}

function upgradeTls(socket: Socket, host: string, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: servernameOf(host) });
    const onReady = () => {
      secure.off('error', onError);
      resolve(secure);
    };
    const onError = (error: Error) => {
      secure.off('secureConnect', onReady);
      reject(error);
    };
    secure.setTimeout(timeoutMs, () => secure.destroy(new Error('SMTP 超时')));
    secure.once('error', onError);
    secure.once('secureConnect', onReady);
  });
}

function parseAuthMechanisms(lines: string[]): string[] {
  for (const line of lines) {
    const match = /^\d{3}[ -]AUTH(?:[ =](.+))?$/i.exec(line);
    if (match) return (match[1] ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);
  }
  return [];
}

function hasStartTls(lines: string[]): boolean {
  return lines.some((line) => /^\d{3}[ -]STARTTLS\b/i.test(line));
}

function parseRecipients(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const address = part.trim();
    if (!address || out.includes(address)) continue;
    out.push(address);
  }
  return out;
}

function buildMessage(config: MailConfig, mail: { subject: string; text: string }, recipients: string[]): string {
  const from = (config.from || config.user).trim();
  const subject = `=?UTF-8?B?${Buffer.from(mail.subject, 'utf8').toString('base64')}?=`;
  // 正文统一 base64：中文、任意换行和以 "." 开头的行都不会破坏 DATA 阶段
  const encoded = Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64');
  const body = encoded.match(/.{1,76}/g)?.join('\r\n') ?? '';
  return [
    `From: ${from}`,
    `To: ${recipients.join(', ')}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@goldsentry.local>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** 发一封纯文本邮件。错误只带步骤与应答码，不回显账号口令 */
export async function sendMail(
  config: MailConfig,
  mail: { subject: string; text: string },
  timeoutMs = 15000,
): Promise<MailResult> {
  const host = config.host.trim();
  const port = Number(config.port);
  const from = (config.from || config.user).trim();
  const recipients = parseRecipients(config.to);
  if (!host) return { ok: false, status: 0, error: '未配置 SMTP 服务器' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, status: 0, error: 'SMTP 端口不合法' };
  }
  if (!/^[^\s@]+@[^\s@]+$/.test(from)) {
    return { ok: false, status: 0, error: '发件人邮箱不合法' };
  }
  if (!recipients.length) return { ok: false, status: 0, error: '未配置收件人' };
  const bad = recipients.find((address) => !/^[^\s@]+@[^\s@]+$/.test(address));
  if (bad) return { ok: false, status: 0, error: `收件人邮箱不合法：${bad}` };

  let socket: Socket | null = null;
  let reader: ReplyReader | null = null;
  try {
    socket = await connectSocket({ ...config, host, port }, timeoutMs);
    reader = new ReplyReader(socket);
    await expectReply(reader, socket, null, [220], '连接');

    let reply = await expectReply(reader, socket, 'EHLO goldsentry.local', [250], 'EHLO');
    let upgraded = false;
    if (!config.secure && hasStartTls(reply.lines)) {
      await expectReply(reader, socket, 'STARTTLS', [220], 'STARTTLS');
      reader.detach();
      socket = await upgradeTls(socket, host, timeoutMs);
      reader = new ReplyReader(socket);
      reply = await expectReply(reader, socket, 'EHLO goldsentry.local', [250], 'EHLO');
      upgraded = true;
    }

    const user = config.user.trim();
    // 服务器没给 STARTTLS 时发口令等于明文上网；要么换 465/587，要么别配认证
    if (user && !config.secure && !upgraded) {
      return { ok: false, status: 0, error: 'SMTP 服务器不支持 STARTTLS，已停止发送以避免明文传输口令' };
    }
    if (user) {
      const mechanisms = parseAuthMechanisms(reply.lines);
      if (mechanisms.includes('PLAIN') && !mechanisms.includes('LOGIN')) {
        const token = Buffer.from(`\0${user}\0${config.pass}`, 'utf8').toString('base64');
        await expectReply(reader, socket, `AUTH PLAIN ${token}`, [235], '认证');
      } else {
        await expectReply(reader, socket, 'AUTH LOGIN', [334], '认证');
        await expectReply(reader, socket, Buffer.from(user, 'utf8').toString('base64'), [334], '认证');
        await expectReply(reader, socket, Buffer.from(config.pass, 'utf8').toString('base64'), [235], '认证');
      }
    }

    await expectReply(reader, socket, `MAIL FROM:<${from}>`, [250], '发件人');
    for (const recipient of recipients) {
      await expectReply(reader, socket, `RCPT TO:<${recipient}>`, [250, 251], '收件人');
    }
    await expectReply(reader, socket, 'DATA', [354], 'DATA');
    socket.write(`${buildMessage({ ...config, host, port }, mail, recipients)}\r\n.\r\n`);
    const delivered = await reader.read();
    if (delivered.code !== 250) throw new SmtpError(delivered.code, smtpErrorMessage(delivered.code, '投递'));

    // QUIT 失败不影响投递结果，不要为此把成功报成失败
    await expectReply(reader, socket, 'QUIT', [221], '退出').catch(() => undefined);
    return { ok: true, status: delivered.code };
  } catch (error) {
    if (error instanceof SmtpError) return { ok: false, status: error.code, error: error.message };
    return { ok: false, status: 0, error: networkMessage(error as Error) };
  } finally {
    reader?.detach();
    socket?.destroy();
  }
}

export async function sendAlertsToMail(
  config: MailConfig,
  alerts: ReadonlyArray<FiredAlert>,
  timeoutMs = 15000,
): Promise<string[]> {
  const errors: string[] = [];
  for (const alert of alerts) {
    const result = await sendMail(config, { subject: alert.title, text: alert.body }, timeoutMs);
    if (!result.ok && result.error) errors.push(result.error);
  }
  return errors;
}
