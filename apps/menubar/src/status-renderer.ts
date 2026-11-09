import { BrowserWindow, nativeImage } from 'electron';
import type { NativeImage } from 'electron';

export interface StatusStripInput {
  label: string;
  price: string;
  pct: string;
  arrow: string;
  mark: string;
  tone: 'up' | 'down' | 'flat';
  dark: boolean;
}

/**
 * 把「名称 价格」画成系统色文字，最后跟一个彩色三角。
 * 函数体会被 toString 后丢进渲染进程执行，不能引用模块作用域里的任何变量。
 */
function drawStrip(data: StatusStripInput): string {
  const S = 2;
  const H = 22;
  // 价格比正文大一号、涨跌幅小一号；顺序是「名称 价格 ▲ 百分比」
  const font = (size: number) => `600 ${size}px -apple-system, "Helvetica Neue", "PingFang SC", sans-serif`;
  const NAME_SIZE = 13;
  const PRICE_SIZE = 14;
  const PCT_SIZE = 12;
  // 用户要求：文字跟随系统但颜色反着来——深色模式黑字、浅色模式白字
  const text = data.dark ? '#000000' : '#ffffff';
  const tone = data.tone === 'up' ? '#ef5350' : data.tone === 'down' ? '#26a269' : text;
  const TRI = 10;
  const GAP = 5;

  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('canvas unavailable');
  const measure = (chunk: string, size: number) => {
    probe.font = font(size);
    return probe.measureText(chunk).width;
  };
  const width = Math.ceil(
    4 +
      (data.mark ? measure(data.mark, NAME_SIZE) + 4 : 0) +
      (data.label ? measure(data.label, NAME_SIZE) + 6 : 0) +
      measure(data.price, PRICE_SIZE) +
      (data.arrow ? GAP + TRI : 0) +
      (data.pct ? GAP + measure(data.pct, PCT_SIZE) : 0) +
      4,
  );

  const canvas = document.createElement('canvas');
  canvas.width = width * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.scale(S, S);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = text;
  const y = H / 2 + 0.5;
  let x = 4;
  if (data.mark) {
    ctx.font = font(NAME_SIZE);
    ctx.fillText(data.mark, x, y);
    x += measure(data.mark, NAME_SIZE) + 4;
  }
  if (data.label) {
    ctx.font = font(NAME_SIZE);
    ctx.fillText(data.label, x, y);
    x += measure(data.label, NAME_SIZE) + 6;
  }
  ctx.font = font(PRICE_SIZE);
  ctx.fillText(data.price, x, y);
  x += measure(data.price, PRICE_SIZE);

  if (data.arrow) {
    x += GAP;
    const cy = H / 2;
    const half = 4.5;
    ctx.beginPath();
    if (data.tone === 'down') {
      ctx.moveTo(x, cy - half);
      ctx.lineTo(x + TRI, cy - half);
      ctx.lineTo(x + TRI / 2, cy + half);
    } else {
      ctx.moveTo(x, cy + half);
      ctx.lineTo(x + TRI, cy + half);
      ctx.lineTo(x + TRI / 2, cy - half);
    }
    ctx.closePath();
    ctx.fillStyle = tone;
    ctx.fill();
    x += TRI;
  }

  if (data.pct) {
    x += GAP;
    ctx.font = font(PCT_SIZE);
    ctx.fillStyle = text;
    ctx.fillText(data.pct, x, y);
  }

  return JSON.stringify({ width, height: H, dataUrl: canvas.toDataURL('image/png') });
}

let renderer: BrowserWindow | null = null;
let ready: Promise<void> | null = null;

async function ensureRenderer(): Promise<BrowserWindow> {
  if (renderer && !renderer.isDestroyed()) {
    await ready;
    return renderer;
  }
  const win = new BrowserWindow({
    show: false,
    width: 240,
    height: 40,
    frame: false,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  renderer = win;
  ready = win.loadURL('data:text/html;charset=utf-8,<!doctype html><meta charset="utf-8">');
  await ready;
  win.on('closed', () => {
    if (renderer === win) {
      renderer = null;
      ready = null;
    }
  });
  return win;
}

/** 画出来是 2 倍像素，标成 scaleFactor=2 交给系统按 22px 高显示 */
export async function renderStatusStrip(input: StatusStripInput): Promise<NativeImage | null> {
  try {
    const win = await ensureRenderer();
    const raw: string = await win.webContents.executeJavaScript(
      `(${drawStrip.toString()})(${JSON.stringify(input)})`,
    );
    const { dataUrl } = JSON.parse(raw) as { dataUrl: string };
    const buffer = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    const image = nativeImage.createFromBuffer(buffer, { scaleFactor: 2 });
    return image.isEmpty() ? null : image;
  } catch (error) {
    console.error('[tray] 状态栏文字渲染失败，退回系统标题', error);
    return null;
  }
}
