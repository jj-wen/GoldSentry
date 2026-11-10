const { existsSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const dir = join(root, 'apps', 'menubar', 'release');
const { version } = JSON.parse(readFileSync(join(root, 'apps', 'menubar', 'package.json'), 'utf8'));

if (!existsSync(dir)) process.exit(0);

// 只留当前版本的安装包；旧版本、解包目录和校验文件每次打包前清掉，避免 release/ 越堆越大
const dirs = new Set(['mac', 'mac-arm64', 'win-unpacked', 'win-ia32-unpacked', 'linux-unpacked']);
const keep = (name) =>
  name === 'RELEASE_NOTES.md' || name.includes(`-${version}-`) || name.includes(`-${version}.`);
const stale = (name) =>
  dirs.has(name) ||
  /\.(dmg|exe|blockmap|zip)$/i.test(name) ||
  name === 'SHA256SUMS.txt' ||
  name === 'builder-debug.yml' ||
  /^latest.*\.yml$/.test(name);

let removed = 0;
for (const name of readdirSync(dir)) {
  if (keep(name) || !stale(name)) continue;
  rmSync(join(dir, name), { recursive: true, force: true });
  removed++;
}
console.log(`[clean-release] 清理 ${removed} 项旧产物，保留 ${version} 的安装包`);