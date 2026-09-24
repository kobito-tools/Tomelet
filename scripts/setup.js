"use strict";

const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { existsSync, realpathSync, statSync } = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./database/connection.js");
const { ensurePrivateDirectories, loadSettings, pathsFor, readJsonIfPresent, writeJsonAtomic } = require("./settings.js");

const projectRoot = path.resolve(__dirname, "..");
const machinePaths = pathsFor();
ensurePrivateDirectories(machinePaths);

function parseArguments(values) {
  const options = { roots: [], check: false };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--check") options.check = true;
    else if (values[index] === "--add-root") {
      const [id, displayName, absolutePath] = values.slice(index + 1, index + 4);
      if (!id || !displayName || !absolutePath) throw new Error("--add-root <ID> <表示名> <絶対パス> の順に指定してください。");
      options.roots.push({ id, displayName, absolutePath });
      index += 3;
    } else throw new Error(`不明な指定です: ${values[index]}`);
  }
  return options;
}

function validateRoot(root) {
  if (!/^[A-Za-z0-9_-]+$/.test(root.id)) throw new Error("基準フォルダIDは英数字・_・-だけを使ってください。");
  if (!path.isAbsolute(root.absolutePath)) throw new Error(`${root.displayName}のパスは絶対パスで指定してください。`);
  const absolutePath = realpathSync(root.absolutePath);
  if (!statSync(absolutePath).isDirectory()) throw new Error(`${root.displayName}はフォルダではありません。`);
  return { id: root.id, displayName: root.displayName, absolutePath };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const current = loadSettings(machinePaths);
  const runtimePaths = pathsFor(machinePaths.dataDirectory, current.contentDirectory);
  ensurePrivateDirectories(runtimePaths);
  const saved = readJsonIfPresent(machinePaths.settingPath) || current;
  const rootsById = new Map((saved.fileRoots || []).map((root) => [root.id, root]));
  options.roots.map(validateRoot).forEach((root) => rootsById.set(root.id, root));
  if (!options.check || options.roots.length || !existsSync(machinePaths.settingPath)) writeJsonAtomic(machinePaths.settingPath, { schemaVersion: 1, revision: current.revision, port: current.port, fileRoots: [...rootsById.values()], theme: current.theme, fontPreset: current.fontPreset, localLlm: current.localLlm, hiddenTagIds: current.hiddenTagIds, contentDirectory: current.contentDirectory });
  if (!existsSync(runtimePaths.integrationsPath)) writeJsonAtomic(runtimePaths.integrationsPath, { schemaVersion: 1, clients: [{ id: "activity-logger", name: "Activity Logger", token: randomBytes(32).toString("hex"), permissions: ["activity:write"] }, { id: "command-center", name: "Command Center", token: randomBytes(32).toString("hex"), permissions: ["journal:read", "journal:write", "search:read"] }] });
  const database = openDatabase(runtimePaths.databasePath, projectRoot, runtimePaths.backupDirectory);
  const integrity = database.prepare("PRAGMA integrity_check").get();
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  database.close();
  if (integrity.integrity_check !== "ok" || foreignKeys.length) throw new Error("データベースの整合性検査に失敗しました。");
  console.log(`Tick Tock Tome設定: OK\n共有データ保存先: ${runtimePaths.contentDirectory}\nPC固有設定: ${machinePaths.dataDirectory}\nDB: ${runtimePaths.databasePath}\n基準フォルダ: ${rootsById.size}件`);
  if (!options.check && process.platform === "darwin") {
    const build = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "build-macos-app.js")], { cwd: projectRoot, encoding: "utf8", shell: false });
    if (build.status !== 0) throw new Error(`macOSアプリの生成に失敗しました: ${(build.stderr || build.stdout).trim()}`);
    console.log(`アプリ生成: ${build.stdout.trim()}`);
  }
}

try { main(); }
catch (error) { console.error(`設定に失敗しました: ${error.message}`); process.exitCode = 1; }
