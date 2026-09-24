"use strict";

// 連携アプリ（例: PopNote!）が呼び出す入口。Tick Tock Tomeのサーバーを本体ウィンドウなしで起動し、
// 接続先ポートとそのアプリ専用トークンをJSONで標準出力へ返す。トークンはログへ書かない。
const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");
const { loadSettings, pathsFor } = require("./settings.js");
const { companions, registerCompanion } = require("./integrations/companions.js");

try {
  const companionId = process.argv[2] || "";
  if (!companions[companionId]) throw new Error(`未対応の連携アプリです: ${companionId || "（未指定）"}`);
  const paths = pathsFor();
  if (!existsSync(paths.settingPath)) throw new Error("Tick Tock Tomeがセットアップされていません。先にTickTockTome-Setup.commandを実行してください。");
  const client = registerCompanion(paths.integrationsPath, companionId);
  const launched = spawnSync(process.execPath, [path.join(__dirname, "launch.js"), "--no-browser"], { encoding: "utf8", shell: false });
  if (launched.status !== 0) throw new Error((launched.stderr || launched.stdout || "Tick Tock Tomeを起動できませんでした。").trim());
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, port: loadSettings(paths).port, token: client.token, clientId: client.id })}\n`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
