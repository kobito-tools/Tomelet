"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules", ".test-output", "Tomelet.app", "TickTockTome.app", "DailyLog.app"]);
const forbiddenNames = new Set(["setting.json", "integrations.json", "ticktocktome.sqlite3", "dailylog.sqlite3", "server.json", "runtime.log"]);
const forbiddenExtensions = new Set([".sqlite", ".sqlite3", ".db", ".backup"]);
const problems = [];
const privateContentPatterns = [
  { label: "実ユーザーのmacOS絶対パス", pattern: /\/Users\/(?!your-name(?:\/|$))[^/\s"']+\// },
  { label: "実ユーザーのWindows絶対パス", pattern: /[A-Za-z]:\\Users\\(?!your-name(?:\\|$))[^\\\s"']+\\/ },
  { label: "保存済み連携トークン", pattern: /"token"\s*:\s*"[A-Fa-f0-9]{32,}"/ },
];
const textExtensions = new Set([".js", ".json", ".md", ".html", ".css", ".sql", ".swift", ".svg", ".command", ".cmd", ".txt"]);
const requiredIgnoreRules = ["data/", "backups/", "exports/", "runtime/", "*.sqlite3", "setting.json", "integrations.json", "*.log", ".test-output/"];

try {
  const ignoreRules = new Set(fs.readFileSync(path.join(root, ".gitignore"), "utf8").split(/\r?\n/).map((line) => line.trim()));
  for (const rule of requiredIgnoreRules) if (!ignoreRules.has(rule)) problems.push(`.gitignore（必須ルール ${rule} がありません）`);
} catch { problems.push(".gitignore（ファイルがありません）"); }

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (forbiddenNames.has(entry.name) || forbiddenExtensions.has(path.extname(entry.name))) problems.push(`${path.relative(root, target)}（私的データ候補）`);
    else if (textExtensions.has(path.extname(entry.name)) && fs.statSync(target).size <= 2_000_000) {
      const content = fs.readFileSync(target, "utf8");
      for (const check of privateContentPatterns) {
        if (check.pattern.test(content)) problems.push(`${path.relative(root, target)}（${check.label}）`);
      }
    }
  }
}

visit(root);
if (problems.length) {
  console.error(`公開してはいけない可能性があるファイルを検出しました:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  process.exitCode = 1;
} else console.log("公開前検査: 個人DB・実設定・実行ログはソースツリー内にありません。");
