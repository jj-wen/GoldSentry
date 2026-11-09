import { spawn } from 'node:child_process';
import type { Rect } from '@goldsentry/core';

/**
 * 判断任务栏贴纸该不该显示。
 *
 * 不能只看"有没有窗口铺满显示器"：最大化/无边框最大化的窗口矩形常常就等于整块
 * 显示器，但任务栏仍然压在它上面可见，此时文字不该消失。之前按窗口矩形判断，
 * 点一下最大化就可能把文字永久藏起来（全屏应用退出后还常留下幽灵窗口）。
 *
 * 这里换个更直接的问法：在任务栏自己的矩形里取几个点，用 WindowFromPoint 问
 * "这个点最上层是哪个窗口"。最上层是任务栏（包括它的子窗口）说明任务栏没被盖住；
 * 命中的是别的应用窗口说明任务栏真被盖住了（全屏视频/游戏），才隐藏文字。
 * 任务栏自动隐藏时它被移出屏幕，点上是桌面或应用，Electron 的 workArea 差也
 * 已经判成"没有任务栏"，两边结论一致。
 *
 * 探针每秒输出一行「被盖住的任务栏矩形」，没被盖住就是空行。空行同时是失败时的
 * 默认值：探针崩了、被杀、卡住 15 秒都按"任务栏可见"处理，宁可文字压在画面上，
 * 也不要永久消失。
 */
const SCRIPT = `Add-Type -Namespace GoldSentry -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
[DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int max);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
'@
$script:trays = @('Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
$script:desktops = @('Progman', 'WorkerW', 'SHELLDLL_DefView', 'SysListView32')
function Class-Of($h) {
  $sb = New-Object System.Text.StringBuilder 128
  [void][GoldSentry.Win]::GetClassName($h, $sb, 128)
  return $sb.ToString()
}
function Test-Covered($tray) {
  $r = New-Object GoldSentry.Win+RECT
  [void][GoldSentry.Win]::GetWindowRect($tray, [ref]$r)
  $w = $r.Right - $r.Left
  $h = $r.Bottom - $r.Top
  if ($w -le 0 -or $h -le 0) { return $false }
  $vertical = $h -gt $w
  $evidence = $false
  foreach ($f in @(0.12, 0.3, 0.5, 0.7, 0.88)) {
    $pt = New-Object GoldSentry.Win+POINT
    if ($vertical) { $pt.X = $r.Left + [int]($w / 2); $pt.Y = $r.Top + [int]($h * $f) }
    else { $pt.X = $r.Left + [int]($w * $f); $pt.Y = $r.Top + [int]($h / 2) }
    $hit = [GoldSentry.Win]::WindowFromPoint($pt)
    if ($hit -eq [IntPtr]::Zero) { continue }
    if ($hit -eq $tray -or [GoldSentry.Win]::IsChild($tray, $hit)) { return $false }
    # Windows 11 的任务栏 UI 可能是贴在同尺寸宿主窗口上的 XAML 岛，别当成遮挡
    $hr = New-Object GoldSentry.Win+RECT
    [void][GoldSentry.Win]::GetWindowRect($hit, [ref]$hr)
    if (([Math]::Abs(($hr.Right - $hr.Left) - $w) -le 4) -and ([Math]::Abs(($hr.Bottom - $hr.Top) - $h) -le 4)) { continue }
    $root = [GoldSentry.Win]::GetAncestor($hit, 2)
    if ($root -eq [IntPtr]::Zero) { $root = $hit }
    $name = Class-Of $root
    if ($script:trays -contains $name) { return $false }
    if (-not ($script:desktops -contains $name)) { $evidence = $true }
  }
  return $evidence
}
while ($true) {
  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }
  $parts = New-Object System.Collections.ArrayList
  $cb = {
    param($h, $l)
    if ([GoldSentry.Win]::IsWindowVisible($h) -and -not [GoldSentry.Win]::IsIconic($h)) {
      $name = Class-Of $h
      if ($script:trays -contains $name) {
        if (Test-Covered $h) {
          $r = New-Object GoldSentry.Win+RECT
          [void][GoldSentry.Win]::GetWindowRect($h, [ref]$r)
          [void]$parts.Add(('{0},{1},{2},{3}' -f $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top)))
        }
      }
    }
    return $true
  }
  [void][GoldSentry.Win]::EnumWindows($cb, [IntPtr]::Zero)
  [Console]::Out.WriteLine((($parts | Sort-Object -Unique) -join ';'))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 1000
}`;

export interface CoverageWatch {
  stop(): void;
}

function parseRects(line: string): Rect[] {
  const rects: Rect[] = [];
  for (const part of line.split(';')) {
    const [x, y, width, height] = part.split(',').map(Number);
    if ([x, y, width, height].every((value) => Number.isFinite(value))) rects.push({ x, y, width, height });
  }
  return rects;
}

const WATCHDOG_SILENCE_MS = 15000;

export function watchTaskbarCoverage(onChange: (rects: Rect[]) => void): CoverageWatch {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  let stopped = false;
  let child: ReturnType<typeof spawn> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let buffered = '';
  let lastLine: string | null = null;
  let lastDataAt = 0;
  // 探针起不来时避免每 2 秒重开一次 PowerShell（编译 Add-Type 很重）
  let restartDelay = 2000;

  const spawnProbe = (): void => {
    if (stopped) return;
    buffered = '';
    lastLine = null;
    lastDataAt = Date.now();
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    child = proc;

    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      if (stopped || child !== proc) return;
      lastDataAt = Date.now();
      restartDelay = 2000;
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) {
        if (line === lastLine) continue;
        lastLine = line;
        onChange(parseRects(line));
      }
    });

    const failed = (reason: string): void => {
      if (stopped || child !== proc) return;
      child = null;
      console.error(`[taskbar] ${reason}，先恢复显示任务栏文字，${restartDelay / 1000} 秒后重启探针`);
      onChange([]);
      restartTimer = setTimeout(spawnProbe, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 30000);
    };
    proc.on('error', (err) => failed(`探针启动失败：${err.message}`));
    proc.on('exit', (code) => failed(`探针意外退出 code=${code}`));
  };

  spawnProbe();
  const watchdog = setInterval(() => {
    if (stopped || !child || Date.now() - lastDataAt <= WATCHDOG_SILENCE_MS) return;
    const hung = child;
    child = null;
    console.error('[taskbar] 探针 15 秒无输出，按任务栏可见处理并重启');
    onChange([]);
    hung.kill();
    restartTimer = setTimeout(spawnProbe, restartDelay);
    restartDelay = Math.min(restartDelay * 2, 30000);
  }, 3000);

  return {
    stop() {
      stopped = true;
      clearInterval(watchdog);
      if (restartTimer) clearTimeout(restartTimer);
      child?.kill();
    },
  };
}
