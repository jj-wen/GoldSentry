import { createServer, type Socket } from 'node:net';
import { createServer as createTlsServer, createSecureContext, TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendMail, type MailConfig } from '../packages/core/src/index.ts';

// 自签名测试证书只用于本地桩服务；连接端需要跳过校验
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/** 证书现场生成，不把任何私钥带进仓库；没有 openssl 的机器跳过 TLS 用例 */
function loadTestCerts(): { key: Buffer; cert: Buffer } | null {
  const dir = mkdtempSync(join(tmpdir(), 'goldsentry-mail-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');
  try {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'],
      { stdio: 'ignore' },
    );
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const certs = loadTestCerts();
const secureContext = certs ? createSecureContext(certs) : null;
const tlsAvailable = certs !== null && secureContext !== null;

const USER = 'bot@example.com';
const PASS = 'SECRET_AUTH_CODE_DO_NOT_LEAK';

type AuthMode = 'none' | 'login' | 'plain' | 'both';
type Mode = 'plain' | 'starttls' | 'tls';

interface SmtpOptions {
  mode: Mode;
  auth: AuthMode;
  expectUser?: string;
  expectPass?: string;
  /** 只接受部分收件人，用来验证 RCPT 失败能被报出来 */
  rejectRecipient?: string;
}

interface SmtpState {
  messages: string[];
  auth: Array<{ user: string; pass: string }>;
  recipients: string[];
  mailFrom: string;
  upgraded: boolean;
}

interface TestServer {
  port: number;
  state: SmtpState;
  close: () => Promise<void>;
}

function createSession(initial: Socket, options: SmtpOptions, state: SmtpState): void {
  let socket: Socket = initial;
  let buffer = '';
  let inData = false;
  let dataLines: string[] = [];
  let authStep: 0 | 1 | 2 = 0;
  let pendingUser = '';
  let authed = false;
  let upgraded = false;

  const write = (text: string) => socket.write(`${text}\r\n`);

  const onData = (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\r\n');
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      handle(line);
      end = buffer.indexOf('\r\n');
    }
  };

  const attach = (next: Socket) => {
    socket = next;
    next.setEncoding('utf8');
    next.on('data', onData);
    next.on('error', () => undefined);
  };

  function ehlo(): void {
    const parts = ['localhost'];
    if (!upgraded && options.mode === 'starttls') parts.push('STARTTLS');
    if (!authed && options.auth !== 'none') {
      parts.push(opts().auth === 'plain' ? 'AUTH PLAIN' : opts().auth === 'login' ? 'AUTH LOGIN' : 'AUTH LOGIN PLAIN');
    }
    const lines = parts.map((part, index) => `250${index === parts.length - 1 ? ' ' : '-'}${part}`);
    socket.write(`${lines.join('\r\n')}\r\n`);
  }

  function opts(): SmtpOptions {
    return options;
  }

  function checkAuth(user: string, pass: string): void {
    state.auth.push({ user, pass });
    if (!options.expectUser || (user === options.expectUser && pass === options.expectPass)) {
      authed = true;
      write('235 authenticated');
    } else {
      write('535 authentication failed');
    }
  }

  function handle(line: string): void {
    if (inData) {
      if (line === '.') {
        inData = false;
        state.messages.push(dataLines.join('\r\n'));
        dataLines = [];
        write('250 queued');
      } else {
        dataLines.push(line);
      }
      return;
    }
    if (authStep === 1) {
      pendingUser = Buffer.from(line, 'base64').toString('utf8');
      authStep = 2;
      write('334 UGFzc3dvcmQ6');
      return;
    }
    if (authStep === 2) {
      checkAuth(pendingUser, Buffer.from(line, 'base64').toString('utf8'));
      authStep = 0;
      return;
    }

    const upper = line.toUpperCase();
    if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
      ehlo();
      return;
    }
    if (upper.startsWith('AUTH LOGIN')) {
      authStep = 1;
      write('334 VXNlcm5hbWU6');
      return;
    }
    if (upper.startsWith('AUTH PLAIN')) {
      const decoded = Buffer.from(line.slice(11).trim(), 'base64').toString('utf8');
      const [, user, pass] = decoded.split('\0');
      checkAuth(user ?? '', pass ?? '');
      return;
    }
    if (upper === 'STARTTLS') {
      if (options.mode !== 'starttls' || upgraded) {
        write('454 tls not available');
        return;
      }
      write('220 starttls');
      socket.off('data', onData);
      if (!secureContext) {
        write('454 tls unavailable');
        return;
      }
      const secure = new TLSSocket(socket, { isServer: true, secureContext });
      upgraded = true;
      state.upgraded = true;
      attach(secure);
      return;
    }
    if (upper.startsWith('MAIL FROM:')) {
      state.mailFrom = line.slice(10).trim();
      write('250 ok');
      return;
    }
    if (upper.startsWith('RCPT TO:')) {
      const address = line.slice(8).trim();
      if (options.rejectRecipient && address.includes(options.rejectRecipient)) {
        write('550 no such user');
        return;
      }
      state.recipients.push(address);
      write('250 ok');
      return;
    }
    if (upper === 'DATA') {
      inData = true;
      dataLines = [];
      write('354 go ahead');
      return;
    }
    if (upper === 'QUIT') {
      write('221 bye');
      socket.end();
      return;
    }
    write('250 ok');
  }

  attach(initial);
  write('220 test-smtp ready');
}

async function startSmtp(options: SmtpOptions): Promise<TestServer> {
  const state: SmtpState = { messages: [], auth: [], recipients: [], mailFrom: '', upgraded: false };
  const server =
    options.mode === 'tls'
      ? createTlsServer({ key: certs!.key, cert: certs!.cert }, (socket) => createSession(socket, options, state))
      : createServer((socket) => createSession(socket, options, state));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('桩服务没有拿到端口');
  return {
    port: address.port,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function config(port: number, patch: Partial<MailConfig> = {}): MailConfig {
  return {
    host: '127.0.0.1',
    port,
    secure: false,
    user: USER,
    pass: PASS,
    from: USER,
    to: 'a@example.com, b@example.com',
    ...patch,
  };
}

function decodeMessage(raw: string): { headers: string; subject: string; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const headers = split >= 0 ? raw.slice(0, split) : raw;
  const body = split >= 0 ? raw.slice(split + 4) : '';
  const subjectLine = headers.split('\r\n').find((line) => line.startsWith('Subject: ')) ?? '';
  const encoded = /=?UTF-8\?B\?([^?]+)\?=/i.exec(subjectLine);
  return {
    headers,
    subject: encoded ? Buffer.from(encoded[1], 'base64').toString('utf8') : subjectLine,
    text: Buffer.from(body, 'base64').toString('utf8'),
  };
}

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

const subject = '积存金日报 · 2026-11-09';
const text = '浙商 开 880.00 收 887.22（+0.82%）\n模拟收益 浮动 +860.00（+10.75%） · 当日 +120.00（+1.37%）';

// TLS 用例需要 openssl 现场生成自签名证书；没有就明确跳过，不把失败混进断言
if (!tlsAvailable) {
  console.log('SKIP  SMTP TLS 用例（本机没有 openssl，无法生成自签名测试证书）');
} else {
  // --- 465 + AUTH LOGIN + 多收件人 ---
  const login = await startSmtp({ mode: 'tls', auth: 'login', expectUser: USER, expectPass: PASS });
  const r1 = await sendMail(config(login.port, { secure: true }), { subject, text }, 3000);
  check('465 + AUTH LOGIN 发送成功', r1.ok && r1.status === 250, JSON.stringify(r1));
  check('认证信息正确送达', login.state.auth[0]?.user === USER && login.state.auth[0]?.pass === PASS);
  check('发件人按 MAIL FROM 传', login.state.mailFrom === `<${USER}>`, login.state.mailFrom);
  check('多个收件人逐个 RCPT', login.state.recipients.length === 2, login.state.recipients.join(','));
  const decoded = decodeMessage(login.state.messages[0] ?? '');
  check('中文主题按 RFC 2047 编码后能还原', decoded.subject === subject, decoded.subject);
  check('正文能还原中文与符号', decoded.text.includes('模拟收益') && decoded.text.includes('+1.37%'), decoded.text);
  check('消息带 Message-ID 与 MIME 头', decoded.headers.includes('Message-ID: <') && decoded.headers.includes('MIME-Version: 1.0'));
  await login.close();

  // --- 密码错误：报错但不回显口令 ---
  const denied = await startSmtp({ mode: 'tls', auth: 'login', expectUser: USER, expectPass: 'another-code' });
  const r2 = await sendMail(config(denied.port, { secure: true }), { subject: 't', text: 'b' }, 3000);
  check('认证失败返回 535', !r2.ok && r2.status === 535, JSON.stringify(r2));
  check('认证失败提示检查授权码', !!r2.error?.includes('认证失败'), r2.error);
  check('错误信息不含口令', !r2.error?.includes(PASS), r2.error);
  await denied.close();

  // --- 只支持 AUTH PLAIN 时走 PLAIN ---
  const plainAuth = await startSmtp({ mode: 'tls', auth: 'plain', expectUser: USER, expectPass: PASS });
  const r3 = await sendMail(config(plainAuth.port, { secure: true }), { subject: 't', text: 'b' }, 3000);
  check('AUTH PLAIN 分支可用', r3.ok, JSON.stringify(r3));
  check('PLAIN 解出的账号正确', plainAuth.state.auth[0]?.user === USER && plainAuth.state.auth[0]?.pass === PASS);
  await plainAuth.close();

  // --- STARTTLS 自动升级 ---
  const starttls = await startSmtp({ mode: 'starttls', auth: 'login', expectUser: USER, expectPass: PASS });
  const r4 = await sendMail(config(starttls.port), { subject: 't', text: 'b' }, 5000);
  check('587 自动 STARTTLS 后发送成功', r4.ok, JSON.stringify(r4));
  check('桩服务确认完成 TLS 升级', starttls.state.upgraded);
  await starttls.close();

  // --- 465 隐式 TLS ---
  const implicit = await startSmtp({ mode: 'tls', auth: 'login', expectUser: USER, expectPass: PASS });
  const r5 = await sendMail(config(implicit.port, { secure: true }), { subject: 't', text: 'b' }, 5000);
  check('465 隐式 TLS 发送成功', r5.ok, JSON.stringify(r5));
  await implicit.close();

  // --- RCPT 被拒：要报收件人失败，不能伪装成功 ---
  const reject = await startSmtp({ mode: 'tls', auth: 'login', expectUser: USER, expectPass: PASS, rejectRecipient: 'b@example.com' });
  const r6 = await sendMail(config(reject.port, { secure: true }), { subject: 't', text: 'b' }, 3000);
  check('收件人被拒返回 550', !r6.ok && r6.status === 550, JSON.stringify(r6));
  check('收件人失败提示明确', !!r6.error?.includes('收件人'), r6.error);
  await reject.close();
}

// --- 明文 + 不认证：内网中继可用，但不会把口令发出去 ---
const noAuth = await startSmtp({ mode: 'plain', auth: 'none' });
const r11 = await sendMail(config(noAuth.port, { user: '', pass: '' }), { subject: 't', text: 'b' }, 3000);
check('不认证的明文中继可以发送', r11.ok, JSON.stringify(r11));
await noAuth.close();

const cleartext = await startSmtp({ mode: 'plain', auth: 'login', expectUser: USER, expectPass: PASS });
const r12 = await sendMail(config(cleartext.port), { subject: 't', text: 'b' }, 3000);
check('不支持 STARTTLS 时拒绝明文认证', !r12.ok && !!r12.error?.includes('STARTTLS'), JSON.stringify(r12));
check('拒绝前没有发出认证信息', cleartext.state.auth.length === 0, JSON.stringify(cleartext.state.auth));
await cleartext.close();

// --- 配置缺项与网络失败 ---
const r7 = await sendMail(config(1, { host: '' }), { subject: 't', text: 'b' });
check('缺 SMTP 服务器直接拒绝', !r7.ok && r7.status === 0 && !!r7.error?.includes('SMTP 服务器'), r7.error);
const r8 = await sendMail(config(1, { to: '' }), { subject: 't', text: 'b' });
check('缺收件人直接拒绝', !r8.ok && !!r8.error?.includes('收件人'), r8.error);
const r9 = await sendMail(config(1, { from: 'not-an-email' }), { subject: 't', text: 'b' });
check('发件人不合法直接拒绝', !r9.ok && !!r9.error?.includes('发件人'), r9.error);
const r10 = await sendMail(config(1), { subject: 't', text: 'b' }, 2000);
check('端口不通有错误且不含口令', !r10.ok && r10.status === 0 && !!r10.error && !r10.error.includes(PASS), r10.error);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exitCode = failures ? 1 : 0;
