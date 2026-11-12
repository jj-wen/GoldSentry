import { formatQuoteCells, priceTone, type PriceTone, type Quote } from '@goldsentry/core';

/** 浏览器速览页：只读、单文件、30 秒自刷新；由主进程每轮取数后重写 */
export interface DashboardOptions {
  quotes: Quote[];
  primarySymbol: string;
  errors: string[];
  updatedAt: number;
}

export const DASHBOARD_REFRESH_SECONDS = 30;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char];
  });
}

function timeText(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function toneClass(tone: PriceTone): string {
  return tone === 'up' ? 'up' : tone === 'down' ? 'down' : 'flat';
}

export function renderDashboardHtml(options: DashboardOptions): string {
  const { quotes, primarySymbol, errors, updatedAt } = options;
  const primary = quotes.find((quote) => quote.symbol === primarySymbol) ?? quotes[0];
  const primaryCells = primary ? formatQuoteCells(primary, updatedAt) : null;
  const primaryTone = primary ? priceTone(primary.dayChangePct) : 'flat';

  const hero = primary
    ? `<section class="hero">
      <div class="hero-name">${escapeHtml(primary.name)}${primary.symbol === primarySymbol ? '<span class="pill">主显</span>' : ''}</div>
      <div class="hero-price ${toneClass(primaryTone)}">${primaryCells?.buy ?? '—'}<small>买入</small></div>
      <div class="hero-meta">
        <span>卖出 ${primaryCells?.sell ?? '—'}</span>
        <span class="${toneClass(primaryTone)}">${primaryCells?.pct ?? '—'}</span>
        <span>${escapeHtml(primaryCells?.update ?? '—')}</span>
      </div>
    </section>`
    : '<section class="hero"><div class="hero-name">暂无报价</div></section>';

  const rows = quotes
    .map((quote) => {
      const cells = formatQuoteCells(quote, updatedAt);
      const isPrimary = quote.symbol === primarySymbol;
      return `<tr class="${isPrimary ? 'is-primary' : ''}">
        <td class="name">${escapeHtml(quote.name)}${isPrimary ? '<span class="dot"></span>' : ''}</td>
        <td class="num">${cells.buy}</td>
        <td class="num">${cells.sell}</td>
        <td class="num ${toneClass(cells.tone)}">${cells.pct}</td>
        <td class="age ${cells.updateStale ? 'stale' : ''}">${escapeHtml(cells.update)}</td>
      </tr>`;
    })
    .join('');

  const errorBlock = errors.length
    ? `<p class="errors">${errors.map((error) => escapeHtml(error)).join('<br />')}</p>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="${DASHBOARD_REFRESH_SECONDS}" />
<title>GoldSentry 速览</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f6f7f8;
    --card: #ffffff;
    --text: #1c1c1e;
    --muted: #8a8a8e;
    --line: #e5e5ea;
    --accent: #c9a227;
    --up: #ef5350;
    --down: #26a269;
    --flat: #8a8a8e;
    --stale: #c28a00;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1b1b1d;
      --card: #242426;
      --text: #f2f2f7;
      --muted: #9b9ba1;
      --line: #3a3a3c;
      --accent: #e0b83a;
      --up: #ff6b6b;
      --down: #3ddc84;
      --flat: #9b9ba1;
      --stale: #e0b83a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 20px 36px;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .wrap { max-width: 680px; margin: 0 auto; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; letter-spacing: 0.02em; }
  h1 span { color: var(--accent); }
  .stamp { color: var(--muted); font-size: 12px; text-align: right; }
  .hero {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 22px 24px;
    margin-bottom: 16px;
  }
  .hero-name { color: var(--muted); font-size: 13px; display: flex; align-items: center; gap: 8px; }
  .pill {
    font-size: 11px;
    color: var(--accent);
    border: 1px solid currentColor;
    border-radius: 999px;
    padding: 0 7px;
    line-height: 1.6;
  }
  .hero-price { font-size: 44px; font-weight: 650; letter-spacing: -0.01em; margin: 4px 0 2px; font-variant-numeric: tabular-nums; }
  .hero-price small { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 8px; }
  .hero-meta { display: flex; gap: 16px; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  th, td { padding: 11px 14px; text-align: left; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: 0; }
  th { font-size: 12px; font-weight: 500; color: var(--muted); }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.age { text-align: right; color: var(--muted); font-size: 12px; white-space: nowrap; }
  td.age.stale { color: var(--stale); }
  tr.is-primary td { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  td.name { font-weight: 500; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); margin-left: 7px; vertical-align: middle; }
  .up { color: var(--up); }
  .down { color: var(--down); }
  .flat { color: var(--flat); }
  .errors { margin-top: 14px; color: var(--up); font-size: 12px; }
  footer { margin-top: 14px; color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Gold<span>Sentry</span> 速览</h1>
      <div class="stamp">更新于 ${timeText(updatedAt)}<br />每 ${DASHBOARD_REFRESH_SECONDS} 秒自动刷新</div>
    </header>
    ${hero}
    <table>
      <thead>
        <tr>
          <th>银行</th>
          <th class="num">买入</th>
          <th class="num">卖出</th>
          <th class="num">今日</th>
          <th class="num">报价</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${errorBlock}
    <footer><span>只读页面，含主显与全部银行；加提醒、改设置请在 GoldSentry 面板操作</span></footer>
  </div>
</body>
</html>`;
}
