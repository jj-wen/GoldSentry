const { accessSync, cpSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');

// 原先是 rm -rf/mkdir -p/cp -r 的 POSIX 写法，Windows 上直接失败
const src = join(__dirname, '..', 'apps', 'vscode');
const destDir = join(homedir(), '.vscode', 'extensions', 'goldsentry-vscode');

for (const needed of ['package.json', join('dist', 'extension.cjs')]) {
  try {
    accessSync(join(src, needed));
  } catch {
    console.error(`[vscode:install] 缺少 ${needed}，先跑 pnpm --filter @goldsentry/vscode build`);
    process.exitCode = 1;
    return;
  }
}

rmSync(destDir, { recursive: true, force: true });
mkdirSync(destDir, { recursive: true });
cpSync(join(src, 'package.json'), join(destDir, 'package.json'));
cpSync(join(src, 'dist'), join(destDir, 'dist'), { recursive: true });
console.log(`[vscode:install] 已安装到 ${destDir}`);
console.log('[vscode:install] 重启 VS Code 后生效，状态栏应出现 GoldSentry');
