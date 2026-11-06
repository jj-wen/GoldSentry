import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sendBark, type BarkConfig } from '../packages/core/src/index.ts';

const KEY = 'SECRET_KEY_DO_NOT_LEAK_1234567890';

interface Stub {
  port: number;
  captured: { url: string; body: string }[];
  close: () => void;
}

async function startStub(status: number): Promise<Stub> {
  const captured: { url: string; body: string }[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      captured.push({ url: req.url ?? '', body: raw });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: status, message: 'stub' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    captured,
    close: () => server.close(),
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
ok200.close();

const s403 = await startStub(403);
const r2 = await sendBark(config(s403.port), { title: 't', body: 'b' });
check('403 映射为 key 失效', !r2.ok && !!r2.error?.includes('device key'), r2.error);
s403.close();

const s400 = await startStub(400);
check('400 映射为参数错误', (await sendBark(config(s400.port), { title: 't', body: 'b' })).error === 'Bark 参数错误');
s400.close();

const s500 = await startStub(500);
check('500 落到通用提示', (await sendBark(config(s500.port), { title: 't', body: 'b' })).error === 'Bark http 500');
s500.close();

const r5 = await sendBark(config(8080, ''), { title: 't', body: 'b' });
check('空 key 直接拒绝，不发请求', !r5.ok && r5.status === 0 && !!r5.error?.includes('未配置'));

const r6 = await sendBark({ server: 'api.day.app', deviceKey: KEY }, { title: 't', body: 'b' });
check('缺 http(s):// 被拦下', !r6.ok && !!r6.error?.includes('http(s)://'), r6.error);

const dead = await startStub(200);
const deadPort = dead.port;
dead.close();
const r7 = await sendBark(config(deadPort), { title: 't', body: 'b' });
check('不可达有错误且错误信息不泄露 key', !r7.ok && !!r7.error && !r7.error.includes(KEY), r7.error);

console.log(failures ? `\n${failures} 项未通过` : '\n全部通过');
process.exit(failures ? 1 : 0);
