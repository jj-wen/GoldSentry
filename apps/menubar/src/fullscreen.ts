import { spawn } from 'node:child_process';
import type { Rect } from '@goldsentry/core';

/**
 * Electron 读不到别的应用是否全屏，workArea 在全屏视频时也仍保留任务栏的保留区。
 * 这里用一条常驻 PowerShell 每秒枚举顶层窗口，输出「被整块盖住的显示器矩形」，
 * 由主进程判断这些矩形有没有盖住任务栏贴纸。只在结果变化时输出，避免频繁起进程。
 *
 * 两类窗口必须排除，否则会永远判成"有全屏"：
 * - DWM 已隐藏（cloaked）的窗口：锁屏预览、其它虚拟桌面上的 UWP 应用等，
 *   IsWindowVisible 仍为真，矩形也常常正好是整块显示器；
 * - 桌面与任务栏自身（Progman / WorkerW / Shell_TrayWnd）。
 * 没有标题的窗体（输入法宿主、桌面 WorkerW）同样不算，防止常驻误报。
 */
const SCRIPT = `Add-Type -Namespace GoldSentry -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int max);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, int flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO info);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
'@
$script:shellClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
$last = 'init'
while ($true) {
  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }
  $rects = New-Object System.Collections.ArrayList
  $cb = {
    param($h, $l)
    if ([GoldSentry.Win]::IsWindowVisible($h) -and -not [GoldSentry.Win]::IsIconic($h) -and [GoldSentry.Win]::GetWindowTextLength($h) -gt 0) {
      $cloaked = 0
      [void][GoldSentry.Win]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
      $cls = New-Object System.Text.StringBuilder 128
      [void][GoldSentry.Win]::GetClassName($h, $cls, 128)
      if ($cloaked -eq 0 -and -not $script:shellClasses.Contains($cls.ToString())) {
        $r = New-Object GoldSentry.Win+RECT
        [void][GoldSentry.Win]::GetWindowRect($h, [ref]$r)
        $m = New-Object GoldSentry.Win+MONITORINFO
        $m.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($m)
        $hm = [GoldSentry.Win]::MonitorFromWindow($h, 2)
        [void][GoldSentry.Win]::GetMonitorInfo($hm, [ref]$m)
        if (($r.Left -le $m.rcMonitor.Left + 2) -and ($r.Top -le $m.rcMonitor.Top + 2) -and ($r.Right -ge $m.rcMonitor.Right - 2) -and ($r.Bottom -ge $m.rcMonitor.Bottom - 2)) {
          [void]$rects.Add(('{0},{1},{2},{3}' -f $m.rcMonitor.Left, $m.rcMonitor.Top, ($m.rcMonitor.Right - $m.rcMonitor.Left), ($m.rcMonitor.Bottom - $m.rcMonitor.Top)))
        }
      }
    }
    return $true
  }
  [void][GoldSentry.Win]::EnumWindows($cb, [IntPtr]::Zero)
  $line = (($rects | Sort-Object -Unique) -join ';')
  if ($line -ne $last) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
    $last = $line
  }
  Start-Sleep -Milliseconds 1000
}`;

export interface FullscreenWatch {
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

export function watchFullscreen(onChange: (rects: Rect[]) => void): FullscreenWatch {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );

  let stopped = false;
  let lastLine: string | null = null;
  let buffered = '';
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (line === lastLine) continue;
      lastLine = line;
      onChange(parseRects(line));
    }
  });

  child.on('error', (err) => {
    if (!stopped) console.error(`[fullscreen] 探针启动失败，全屏时任务栏文字不会隐藏：${err.message}`);
  });
  child.on('exit', (code) => {
    if (!stopped) console.error(`[fullscreen] 探针意外退出 code=${code}，全屏时任务栏文字不会隐藏`);
  });

  return {
    stop() {
      stopped = true;
      child.kill();
    },
  };
}
