"use strict";

const { copyFileSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = realpathSync(path.resolve(__dirname, ".."));

function xml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]); }
function run(command, args, label) { const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8", shell: false }); if (result.status !== 0) throw new Error(`${label}に失敗しました: ${(result.stderr || result.stdout).trim()}`); return result.stdout.trim(); }

// Swiftの単一ファイルから、プロジェクト直下へ.appを作る。作成に失敗した場合は以前の.appを残す。
function buildMacApp({ bundleName, executableName, bundleIdentifier, displayName, sourceName, iconName, extraPlist = "" }) {
  if (process.platform !== "darwin") throw new Error(`${bundleName}の作成はmacOSだけに対応しています。`);
  const sourcePath = path.join(projectRoot, "scripts", sourceName);
  const appPath = path.join(projectRoot, bundleName);
  const stamp = `${process.pid}.${Date.now()}`;
  const temporaryPath = path.join(projectRoot, `.${bundleName}.${stamp}.tmp`);
  const previousPath = path.join(projectRoot, `.${bundleName}.${stamp}.previous`);
  const contentsPath = path.join(temporaryPath, "Contents");
  const executablePath = path.join(contentsPath, "MacOS", executableName);
  const swiftc = run("/usr/bin/xcrun", ["--find", "swiftc"], "Swiftコンパイラの確認");
  const sdkPath = run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"], "macOS SDKの確認");
  const architecture = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x86_64" : null;
  if (!architecture) throw new Error(`未対応CPUです: ${process.arch}`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleDevelopmentRegion</key><string>ja</string>
<key>CFBundleDisplayName</key><string>${xml(displayName)}</string>
<key>CFBundleExecutable</key><string>${xml(executableName)}</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundleIdentifier</key><string>${xml(bundleIdentifier)}</string>
<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
<key>CFBundleName</key><string>${xml(displayName)}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>TickTockTomeProjectRoot</key><string>${xml(projectRoot)}</string>
<key>TickTockTomeNodePath</key><string>${xml(realpathSync(process.execPath))}</string>
${extraPlist}</dict></plist>`;

  rmSync(temporaryPath, { recursive: true, force: true });
  mkdirSync(path.dirname(executablePath), { recursive: true });
  mkdirSync(path.join(contentsPath, "Resources"), { recursive: true });
  try {
    writeFileSync(path.join(contentsPath, "Info.plist"), plist, { flag: "wx", mode: 0o644 });
    copyFileSync(path.join(projectRoot, "assets", "icon", iconName), path.join(contentsPath, "Resources", "AppIcon.icns"));
    run(swiftc, ["-sdk", sdkPath, "-target", `${architecture}-apple-macosx12.0`, "-parse-as-library", sourcePath, "-O", "-framework", "Cocoa", "-framework", "WebKit", "-o", executablePath], `${bundleName}のコンパイル`);
    run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", temporaryPath], `${bundleName}の署名`);
    if (existsSync(appPath)) renameSync(appPath, previousPath);
    renameSync(temporaryPath, appPath);
    rmSync(previousPath, { recursive: true, force: true });
  } catch (error) {
    rmSync(temporaryPath, { recursive: true, force: true });
    if (existsSync(previousPath) && !existsSync(appPath)) renameSync(previousPath, appPath);
    throw error;
  }
  // 連携アプリ（PopNote!）がバンドルIDからこのアプリを見つけられるよう、Launch Servicesへ登録する。
  const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  if (existsSync(lsregister)) spawnSync(lsregister, ["-f", appPath], { stdio: "ignore", shell: false });
  return appPath;
}

module.exports = { buildMacApp, projectRoot };
