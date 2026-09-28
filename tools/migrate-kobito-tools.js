"use strict";

// 旧形式の <基準パス>/.TickTockTome/ を .kobito-tools/（Tomelet/・PopNote/・Tags/）へ分割移行する。
// Tomeletは基準パスを開くときに自動で移行するため、通常は不要。TomeletとPopNote!を終了してから実行する。
//   node tools/migrate-kobito-tools.js <基準パス>
const fs = require("node:fs");
const path = require("node:path");
const dataset = require("../scripts/dataset.js");

function main() {
  const requested = process.argv[2];
  if (!requested) throw new Error("使い方: node tools/migrate-kobito-tools.js <基準パス>");
  const basePath = dataset.normalizeBasePath(fs.realpathSync(requested));
  const result = dataset.migrateLegacyLayout(basePath, { projectRoot: path.resolve(__dirname, "..") });
  if (!result) throw new Error(`${basePath} に旧形式の .TickTockTome/ が見つかりません。`);
  console.log(`「${result.datasetId}」を移行しました（メモ ${result.memos}件、タグ ${result.tags}件）。`);
  console.log(`新しい保存先: ${path.join(basePath, ".kobito-tools")}`);
  console.log(`旧フォルダ: ${result.archivedDirectory}`);
}

try { main(); } catch (error) { console.error(`移行に失敗しました: ${error.message}`); process.exitCode = 1; }
