"use strict";

const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("./database/connection.js");
const { datasetPaths, readDataset } = require("./dataset.js");
const { loadSettings, pathsFor, writeJsonAtomic } = require("./settings.js");

const projectRoot = path.resolve(__dirname, "..");
const machinePaths = pathsFor();
for (const directory of [machinePaths.configDirectory, machinePaths.runtimeDirectory]) mkdirSync(directory, { recursive: true, mode: 0o700 });

function parseArguments(values) {
  const options = { check: false };
  for (const value of values) {
    if (value === "--check") options.check = true;
    else throw new Error(`不明な指定です: ${value}`);
  }
  return options;
}

// 基準パスの選択はアプリ画面で行う。ここでは連携設定の用意と、開いているデータセットの検査だけを行う。
function main() {
  const options = parseArguments(process.argv.slice(2));
  const current = loadSettings(machinePaths);
  const runtimePaths = machinePaths;
  if (!existsSync(runtimePaths.integrationsPath)) writeJsonAtomic(runtimePaths.integrationsPath, { schemaVersion: 1, clients: [{ id: "activity-logger", name: "Activity Logger", token: randomBytes(32).toString("hex"), permissions: ["activity:write"] }, { id: "command-center", name: "Command Center", token: randomBytes(32).toString("hex"), permissions: ["journal:read", "journal:write", "search:read"] }] });
  const dataset = current.basePath && existsSync(current.basePath) ? readDataset(current.basePath) : null;
  if (dataset) {
    const paths = datasetPaths(machinePaths.dataDirectory, current.basePath);
    const database = openDatabase(paths.databasePath, projectRoot, paths.backupDirectory);
    const integrity = database.prepare("PRAGMA integrity_check").get();
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    database.close();
    if (integrity.integrity_check !== "ok" || foreignKeys.length) throw new Error("データベースの整合性検査に失敗しました。");
  }
  console.log(`Tomelet設定: OK\nPC固有設定: ${machinePaths.dataDirectory}\n基準パス: ${current.basePath || "未設定（アプリ画面で選択してください）"}${dataset ? `\nID: ${dataset.datasetId}` : current.basePath ? "\n基準パスのデータ: 見つかりません" : ""}`);
  if (!options.check && process.platform === "darwin") {
    const build = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "build-macos-app.js")], { cwd: projectRoot, encoding: "utf8", shell: false });
    if (build.status !== 0) throw new Error(`macOSアプリの生成に失敗しました: ${(build.stderr || build.stdout).trim()}`);
    console.log(`アプリ生成: ${build.stdout.trim()}`);
  }
}

try { main(); }
catch (error) { console.error(`設定に失敗しました: ${error.message}`); process.exitCode = 1; }
