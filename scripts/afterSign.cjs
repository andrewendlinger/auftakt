const { execFileSync } = require('node:child_process');
const path = require('node:path');

/**
 * We have no Apple Developer ID, so electron-builder skips code signing and the
 * resulting arm64 app is unsigned — which macOS reports as "damaged". Ad-hoc sign
 * the whole bundle here so it's a valid arm64 app. (This does NOT satisfy Gatekeeper
 * for downloaded apps — that needs Apple notarization — but it makes the app runnable
 * once the user removes the quarantine flag; see the README.)
 */
exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`· ad-hoc signing ${appPath}`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
