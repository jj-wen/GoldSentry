import { spawn } from 'node:child_process';
import type { Rect } from '@goldsentry/core';

/**
 * Electron 读不到别的应用是否全屏，workArea 在全屏视频时也仍保留任务栏的保留区。
 * 这里用一条常驻 PowerShell 每秒枚举顶层窗口，输出「被整块盖住的显示器矩形」，
 * 由主进程判断这些矩形有没有盖住任务栏贴纸。
 *
 * 三类窗口必须排除，否则会永远判成"有全屏"：
 * - DWM 已隐藏（cloaked）的窗口：锁屏预览、其它虚拟桌面上的 UWP 应用等，
 *   IsWindowVisible 仍为真，矩形也常常正好是整块显示器；
 * - 桌面与任务栏自身（Progman / WorkerW / Shell_TrayWnd）；
 * - 不在前台、且与前台窗口在同一块显示器上的全屏尺寸窗口：全屏应用退出后
 *   常留下这种"幽灵窗口"，会把文字一直压在隐藏态；前台在别的显示器时仍保留，
 *   这样副屏全屏不会影响主屏贴纸。
 *
 * 探针每秒输出一行（内容没变也输出），主进程用最后收到数据的时间做看门狗：
 * PowerShell 被杀或卡住时立刻回退为显示文字并重启探针，避免永远停在隐藏态。
 */
const SCRIPT = `Add-Type -Namespace GoldSentry -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder text, int max);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
[DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, int flags);
[DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO info);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
'@
$script:shellClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd')
function Get-MonitorKey($info) { '{0},{1},{2},{3}' -f $info.rcMonitor.Left, $info.rcMonitor.Top, ($info.rcMonitor.Right - $info.rcMonitor.Left), ($info.rcMonitor.Bottom - $info.rcMonitor.Top) }
while ($true) {
  if (-not (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue)) { break }
  $script:fg = [GoldSentry.Win]::GetForegroundWindow()
  $fgInfo = New-Object GoldSentry.Win+MONITORINFO
  $fgInfo.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($fgInfo)
  [void][GoldSentry.Win]::GetMonitorInfo([GoldSentry.Win]::MonitorFromWindow($script:fg, 2), [ref]$fgInfo)
  $script:fgKey = Get-MonitorKey $fgInfo
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
          $key = Get-MonitorKey $m
          if (($h.ToInt64() -eq $script:fg.ToInt64()) -or ($key -ne $script:fgKey)) {
            [void]$rects.Add($key)
          }
        }
      }
    }
    return $true
  }
  [void][GoldSentry.Win]::EnumWindows($cb, [IntPtr]::Zero)
  $line = (($rects | Sort-Object -Unique) -join ';')
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
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

const WATCHDOG_SILENCE_MS = 15000;

export function watchFullscreen(onChange: (rects: Rect[]) => void): FullscreenWatch {
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
      console.error(`[fullscreen] ${reason}，先恢复显示任务栏文字，${restartDelay / 1000} 秒后重启探针`);
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
    console.error('[fullscreen] 探针 15 秒无输出，按全屏结束处理并重启');
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
