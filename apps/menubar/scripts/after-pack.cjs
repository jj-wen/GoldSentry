const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

// 未做 ad-hoc 签名的 mac 包从网络下载后会被 Gatekeeper 判成“已损坏”，
// 右键打开也过不去；签完只会提示“无法验证开发者”，可正常放行。
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
};
