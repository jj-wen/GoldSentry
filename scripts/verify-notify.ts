import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sendAlertsToWebhook, sendBark, sendBot, sendWebhook, type BarkConfig, type BotConfig } from '../packages/core/src/index.ts';

const KEY = 'SECRET_KEY_DO_NOT_LEAK_1234567890';

interface Stub {
  port: number;
  captured: { url: string; body: string }[];
  close: () => Promise<void>;
}

async function startStub(status: number, reply: unknown = { code: status }): Promise<Stub> {
  const captured: { url: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      captured.push({ url: req.url ?? '', body: raw });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    captured,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

let failures = 0;
function check(label: string, condition: boolean, extra = ''): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures++;
}

const config = (port: number, key = KEY): BarkConfig => ({
  server: `http://127.0.0.1:${port}`,
  deviceKey: key,
  group: 'GoldSentry',
  level: 'timeSensitive',
});

const ok200 = await startStub(200);
const r1 = await sendBark(config(ok200.port), { title: '浙商积存金 涨到 885.66', body: '阈值 880.00' });
check('200 判定成功', r1.ok && r1.status === 200);
const sent = JSON.parse(ok200.captured[0].body);
check('走 POST /push，key 不在 URL 路径里', ok200.captured[0].url === '/push', ok200.captured[0].url);
check('device_key 在请求体内', sent.device_key === KEY);
check('group/level 透传', sent.group === 'GoldSentry' && sent.level === 'timeSensitive');
check('title/body 原样', sent.title.includes('885.66') && sent.body.includes('阈值'));
await ok200.close();

const s403 = await startStub(403);
const r2 = await sendBark(config(s403.port), { title: 't', body: 'b' });
check('403 映射为 key 失效', !r2.ok && !!r2.error?.includes('device key'), r2.error);
await s403.close();

const s400 = await startStub(400);
check('400 映射为参数错误', (await sendBark(config(s400.port), { title: 't', body: 'b' })).error === 'Bark 参数错误');
await s400.close();

const s500 = await startStub(500);
check('500 落到通用提示', (await sendBark(config(s500.port), { title: 't', body: 'b' })).error === 'Bark http 500');
await s500.close();

const r5 = await sendBark(config(8080, ''), { title: 't', body: 'b' });
check('空 key 直接拒绝，不发请求', !r5.ok && r5.status === 0 && !!r5.error?.includes('未配置'));

const r6 = await sendBark({ server: 'api.day.app', deviceKey: KEY }, { title: 't', body: 'b' });
check('缺 http(s):// 被拦下', !r6.ok && !!r6.error?.includes('http(s)://'), r6.error);

const dead = await startStub(200);
const deadPort = dead.port;
await dead.close();
const r7 = await sendBark(config(deadPort), { title: 't', body: 'b' });
check('不可达有错误且错误信息不泄露 key', !r7.ok && !!r7.error && !r7.error.includes(KEY), r7.error);

// --- Webhook：通用 JSON POST，URL 里可能带 token，错误信息不能回显 ---
const hook = await startStub(200);
const w1 = await sendWebhook(
  { url: `http://127.0.0.1:${hook.port}/hook?token=${KEY}` },
  { title: '积存金日报', body: '浙商 收 887.22' },
);
check('Webhook 200 判定成功', w1.ok && w1.status === 200);
const hookBody = JSON.parse(hook.captured[0].body);
check('Webhook 带 title/body/source', hookBody.title === '积存金日报' && hookBody.body.includes('887.22') && hookBody.source === 'GoldSentry');
check('Webhook 不把 token 写进请求体', !hook.captured[0].body.includes(KEY));
await hook.close();

const w2 = await sendWebhook({ url: 'ftp://example.com/hook' }, { title: 't', body: 'b' });
check('Webhook 只接受 http(s)', !w2.ok && !!w2.error?.includes('http(s)://'), w2.error);

const deadHook = await startStub(200);
const deadHookUrl = `http://127.0.0.1:${deadHook.port}/hook?token=${KEY}`;
await deadHook.close();
const w3 = await sendWebhook({ url: deadHookUrl }, { title: 't', body: 'b' });
check('Webhook 不可达有错误且不回显 URL', !w3.ok && !!w3.error && !w3.error.includes(KEY), w3.error);

const multi = await startStub(200);
const errors = await sendAlertsToWebhook(
  { url: `http://127.0.0.1:${multi.port}/hook` },
  [
    { ruleId: 'a', symbol: 'ZS', title: 't1', body: 'b1' },
    { ruleId: 'b', symbol: 'GS', title: 't2', body: 'b2' },
  ],
);
check('Webhook 每条提醒各发一次', errors.length === 0 && multi.captured.length === 2, String(multi.captured.length));
await multi.close();

// --- 机器人预设：载荷随平台变化，业务错误码也要当失败 ---
const bot = (patch: Partial<BotConfig>): BotConfig => ({
  type: 'feishu',
  url: '',
  secret: '',
  token: '',
  chatId: '',
  ...patch,
});

const feishu = await startStub(200, { code: 0, msg: 'success' });
const b1 = await sendBot(
  bot({ type: 'feishu', url: `http://127.0.0.1:${feishu.port}/hook?token=${KEY}` }),
  { title: '积存金日报', body: '浙商 收 887.22' },
);
check('飞书机器人发送成功', b1.ok, JSON.stringify(b1));
const feishuBody = JSON.parse(feishu.captured[0].body);
check(
  '飞书载荷是 msg_type/text',
  feishuBody.msg_type === 'text' && feishuBody.content.text.includes('积存金日报') && feishuBody.content.text.includes('887.22'),
);
await feishu.close();

const feishuErr = await startStub(200, { code: '19001', msg: 'param error' });
const b2 = await sendBot(bot({ type: 'feishu', url: `http://127.0.0.1:${feishuErr.port}/hook?token=${KEY}` }), {
  title: 't',
  body: 'b',
});
check('飞书业务错误码判失败', !b2.ok && !!b2.error?.includes('飞书'), JSON.stringify(b2));
check('飞书错误不回显地址 token', !b2.error?.includes(KEY), b2.error);
await feishuErr.close();

const DING_SECRET = 'DING_SECRET_DO_NOT_LEAK';
const ding = await startStub(200, { errcode: 0, errmsg: 'ok' });
const b3 = await sendBot(
  bot({
    type: 'dingtalk',
    url: `http://127.0.0.1:${ding.port}/robot/send?access_token=${KEY}`,
    secret: DING_SECRET,
  }),
  { title: 't', body: 'b' },
);
check('钉钉机器人发送成功', b3.ok, JSON.stringify(b3));
const dingUrl = new URL(ding.captured[0].url, 'http://localhost');
const timestamp = dingUrl.searchParams.get('timestamp') ?? '';
const sign = dingUrl.searchParams.get('sign') ?? '';
const expectedSign = createHmac('sha256', DING_SECRET).update(`${timestamp}\n${DING_SECRET}`).digest('base64');
check('钉钉带 timestamp 与加签', !!timestamp && sign === expectedSign, sign);
const dingBody = JSON.parse(ding.captured[0].body);
check('钉钉载荷是 msgtype/text', dingBody.msgtype === 'text' && dingBody.text.content.includes('t\nb'));
await ding.close();

const dingErr = await startStub(200, { errcode: 310000, errmsg: 'keywords not in content' });
const b4 = await sendBot(bot({ type: 'dingtalk', url: `http://127.0.0.1:${dingErr.port}/robot` }), { title: 't', body: 'b' });
check('钉钉业务错误码判失败', !b4.ok && !!b4.error?.includes('310000'), JSON.stringify(b4));
await dingErr.close();

const wecom = await startStub(200, { errcode: 0, errmsg: 'ok' });
const b5 = await sendBot(bot({ type: 'wecom', url: `http://127.0.0.1:${wecom.port}/cgi-bin/webhook/send?key=${KEY}` }), {
  title: 't',
  body: 'b',
});
check('企业微信发送成功', b5.ok, JSON.stringify(b5));
check('企业微信载荷是 msgtype/text', JSON.parse(wecom.captured[0].body).msgtype === 'text');
await wecom.close();

const wecomErr = await startStub(200, { errcode: 93000, errmsg: 'invalid webhook url' });
const b6 = await sendBot(bot({ type: 'wecom', url: `http://127.0.0.1:${wecomErr.port}/hook` }), { title: 't', body: 'b' });
check('企业微信业务错误码判失败', !b6.ok && !!b6.error?.includes('93000'), JSON.stringify(b6));
await wecomErr.close();

const telegram = await startStub(200, { ok: true, result: { message_id: 1 } });
const b7 = await sendBot(
  bot({ type: 'telegram', token: KEY, chatId: '12345', apiBase: `http://127.0.0.1:${telegram.port}` }),
  { title: '积存金日报', body: '浙商 收 887.22' },
);
check('Telegram 发送成功', b7.ok, JSON.stringify(b7));
check('Telegram 走 bot token 路径', telegram.captured[0].url === `/bot${KEY}/sendMessage`, telegram.captured[0].url);
const tgBody = JSON.parse(telegram.captured[0].body);
check('Telegram 带 chat_id 与文本', tgBody.chat_id === '12345' && tgBody.text.includes('887.22'));
await telegram.close();

const telegramErr = await startStub(200, { ok: false, description: 'chat not found' });
const b8 = await sendBot(
  bot({ type: 'telegram', token: KEY, chatId: '404', apiBase: `http://127.0.0.1:${telegramErr.port}` }),
  { title: 't', body: 'b' },
);
check('Telegram 业务错误判失败', !b8.ok && !!b8.error?.includes('chat not found'), JSON.stringify(b8));
check('Telegram 错误不回显 token', !b8.error?.includes(KEY), b8.error);
await telegramErr.close();

check('Telegram 缺 token 直接拒绝', (await sendBot(bot({ type: 'telegram', chatId: '1' }), { title: 't', body: 'b' })).error?.includes('token') === true);
check('Telegram 缺 chat id 直接拒绝', (await sendBot(bot({ type: 'telegram', token: 'x' }), { title: 't', body: 'b' })).error?.includes('chat id') === true);
check(
  '机器人地址必须以 http(s) 开头',
  (await sendBot(bot({ type: 'wecom', url: 'wecom.example.com/hook' }), { title: 't', body: 'b' })).error?.includes('http(s)://') === true,
);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
// 只设 exitCode、让事件循环自己排空：Windows + Node 24 上直接 process.exit()
// 会撞上 libuv 断言（src/win/async.c UV_HANDLE_CLOSING），把全绿的运行报成失败
process.exitCode = failures ? 1 : 0;
