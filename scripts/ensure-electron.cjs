const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

// pnpm 10 默认不执行依赖的 postinstall，Electron 二进制会拖到首次运行时才下载，
// 那条路径在受限网络下会直接失败。这里在安装期显式补上。
const requireFromApp = createRequire(path.join(__dirname, '..', 'apps', 'menubar', 'package.json'));

let electronDir;
try {
  electronDir = path.dirname(requireFromApp.resolve('electron/package.json'));
} catch {
  console.log('[ensure-electron] 未找到 electron 包，跳过');
  process.exit(0);
}

const ready = ['Electron.app', 'electron.exe', 'electron'].some((name) =>
  existsSync(path.join(electronDir, 'dist', name)),
);
if (ready) {
  console.log('[ensure-electron] 二进制已就位');
  process.exit(0);
}

console.log('[ensure-electron] 首次下载 Electron 二进制（走镜像，约 100MB）…');
execFileSync(process.execPath, ['install.js'], {
  cwd: electronDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  },
});
console.log('[ensure-electron] 完成');
