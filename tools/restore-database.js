"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { createVerifiedBackup } = require("../scripts/database/backup.js");
const { ensurePrivateDirectories, pathsFor } = require("../scripts/settings.js");

function verify(filePath) {
  const database = new DatabaseSync(filePath, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (integrity !== "ok" || foreignKeys.length) throw new Error("指定したバックアップの整合性検査に失敗しました。");
  } finally { database.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--from");
  if (index < 0 || !args[index + 1]) throw new Error("--from <バックアップDB> を指定してください。");
  const source = fs.realpathSync(args[index + 1]);
  const runtimePaths = pathsFor();
  ensurePrivateDirectories(runtimePaths);
  if (fs.existsSync(runtimePaths.pidPath)) throw new Error("先にTick Tock Tomeを終了してください。");
  verify(source);
  if (fs.existsSync(runtimePaths.databasePath)) await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory, "before-restore");
  const temporary = `${runtimePaths.databasePath}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  verify(temporary);
  const previous = `${runtimePaths.databasePath}.${process.pid}.${Date.now()}.previous`;
  try {
    if (fs.existsSync(runtimePaths.databasePath)) fs.renameSync(runtimePaths.databasePath, previous);
    fs.renameSync(temporary, runtimePaths.databasePath);
    fs.rmSync(`${runtimePaths.databasePath}-wal`, { force: true });
    fs.rmSync(`${runtimePaths.databasePath}-shm`, { force: true });
    fs.rmSync(previous, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(previous) && !fs.existsSync(runtimePaths.databasePath)) fs.renameSync(previous, runtimePaths.databasePath);
    throw error;
  }
  console.log("データベースを復元しました。起動前にcheck-database.jsを実行してください。");
}

main().catch((error) => { console.error(`復元に失敗しました: ${error.message}`); process.exitCode = 1; });
