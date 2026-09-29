"use strict";

// GitHubのReleasesへ添付する、macOS用のdmgを作る。dist/Tomelet_<版>_universal.dmg
// .appの中にソース（コミット済みのものだけ）・Node.js・常駐タイマーを同梱し、Node.jsやXcodeの無いMacでも動くようにする。
//   Contents/MacOS/Tomelet            画面（Swift、ユニバーサル）
//   Contents/MacOS/node               同梱のNode.js（公式のarm64版とx64版をlipoでまとめる）
//   Contents/MacOS/TickTockTomeTimer  常駐タイマー（scripts/timer-window.jsがnodeの隣から使う）
//   Contents/Resources/app/           サーバーと画面のソース
// 使い方: node tools/package-macos-release.js
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildMacApp, compileSwift, projectRoot, run } = require("../scripts/macos-app-bundle.js");

// Node 24以降はmacOS 13.5以上が必要なため、macOS 12にも対応する22系を同梱する。
const NODE_VERSION = "v22.23.3";
const ARCHITECTURES = [["arm64", "arm64"], ["x86_64", "x64"]];
// .appに入れるもの。テスト・開発用ツール・文書・Windows用の入口は入れない。
const APP_FILES = ["index.html", "favicon.svg", "package.json", "LICENSE", "css", "js", "animations", "assets", "migrations", "scripts"];

const cacheDirectory = path.join(projectRoot, ".build", "node");
const distDirectory = path.join(projectRoot, "dist");

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ダウンロードに失敗しました（${response.status}）: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

// nodejs.orgの公式ビルドを取得し、SHASUMS256.txtと照合してから展開する。
async function nodeBinary(nodeArchitecture) {
  const name = `node-${NODE_VERSION}-darwin-${nodeArchitecture}`;
  const binary = path.join(cacheDirectory, name, "bin", "node");
  if (existsSync(binary)) return binary;
  mkdirSync(cacheDirectory, { recursive: true });
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString("utf8");
  const expected = sums.split("\n").map((line) => line.trim().split(/\s+/)).find(([, file]) => file === `${name}.tar.gz`)?.[0];
  if (!expected) throw new Error(`SHASUMS256.txtに${name}.tar.gzがありません。`);
  const archive = await download(`${base}/${name}.tar.gz`);
  if (createHash("sha256").update(archive).digest("hex") !== expected) throw new Error(`${name}.tar.gzのハッシュが一致しません。`);
  const archivePath = path.join(cacheDirectory, `${name}.tar.gz`);
  writeFileSync(archivePath, archive);
  run("/usr/bin/tar", ["-xzf", archivePath, "-C", cacheDirectory, `${name}/bin/node`, `${name}/LICENSE`], "Node.jsの展開");
  rmSync(archivePath, { force: true });
  return binary;
}

function sign(target) { run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", target], `${path.basename(target)}の署名`); }

async function main() {
  if (process.platform !== "darwin") throw new Error("macOSで実行してください。");
  const { version } = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const dirty = run("/usr/bin/git", ["status", "--porcelain", "--", ...APP_FILES], "Gitの状態確認");
  if (dirty) console.warn(`注意: コミットしていない変更は含まれません。\n${dirty}`);
  const nodeBinaries = [];
  for (const [, nodeArchitecture] of ARCHITECTURES) nodeBinaries.push(await nodeBinary(nodeArchitecture));

  const stage = mkdtempSync(path.join(os.tmpdir(), "tomelet-release-"));
  try {
    const appPath = buildMacApp({
      bundleName: "Tomelet.app", executableName: "Tomelet", bundleIdentifier: "local.ticktocktome.desktop", displayName: "Tomelet", sourceName: "TickTockTomeApp.swift", iconName: "app-icon.icns",
      outputDirectory: stage, projectRootValue: "Contents/Resources/app", nodePathValue: "Contents/MacOS/node",
      architectures: ARCHITECTURES.map(([architecture]) => architecture), register: false,
      populate(contentsPath) {
        const macOS = path.join(contentsPath, "MacOS"), app = path.join(contentsPath, "Resources", "app");
        run("/usr/bin/lipo", ["-create", ...nodeBinaries, "-output", path.join(macOS, "node")], "Node.jsのユニバーサル化");
        compileSwift(path.join(projectRoot, "scripts", "TimerWindow.swift"), path.join(macOS, "TickTockTomeTimer"), { architectures: ARCHITECTURES.map(([architecture]) => architecture) });
        // 内側の実行ファイルから先に署名する（.app全体の署名はbuildMacAppが行う）。
        sign(path.join(macOS, "node"));
        sign(path.join(macOS, "TickTockTomeTimer"));
        // コミット済みのファイルだけを入れる（手元のDB・設定・ログが紛れ込まないように）。
        mkdirSync(app, { recursive: true });
        const tarPath = path.join(stage, "app.tar");
        run("/usr/bin/git", ["archive", "--format=tar", "-o", tarPath, "HEAD", "--", ...APP_FILES], "ソースの書き出し");
        run("/usr/bin/tar", ["-xf", tarPath, "-C", app], "ソースの展開");
        rmSync(tarPath, { force: true });
        for (const file of ["TickTockTomeApp.swift", "TimerWindow.swift", "TimerWindow.ps1", "build-macos-app.js", "setup.js"]) rmSync(path.join(app, "scripts", file), { force: true });
        run("/bin/cp", [path.join(path.dirname(path.dirname(nodeBinaries[0])), "LICENSE"), path.join(contentsPath, "Resources", "node-LICENSE")], "Node.jsのライセンスのコピー");
      },
    });

    // 開くとTomelet.appとApplicationsフォルダが並び、ドラッグでインストールできる形にする。
    symlinkSync("/Applications", path.join(stage, "Applications"));
    mkdirSync(distDirectory, { recursive: true });
    const dmgPath = path.join(distDirectory, `Tomelet_${version}_universal.dmg`);
    rmSync(dmgPath, { force: true });
    run("/usr/bin/hdiutil", ["create", "-volname", "Tomelet", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-imagekey", "zlib-level=9", "-ov", dmgPath], "dmgの作成");
    console.log(`${dmgPath}\n（${path.relative(stage, appPath)} に Node.js ${NODE_VERSION} を同梱）`);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
