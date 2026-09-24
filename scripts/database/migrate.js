"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function createMigrationBackup(database, backupDirectory) {
  if (!backupDirectory) return null;
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const target = path.join(backupDirectory, `ticktocktome-before-migration-${stamp}.sqlite3`);
  database.exec(`VACUUM INTO ${quoteSqlString(target)}`);
  const verification = new DatabaseSync(target, { readOnly: true });
  try {
    if (verification.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("バックアップの整合性検査に失敗しました。");
  } finally { verification.close(); }
  return target;
}

function migrate(database, migrationsDirectory, backupDirectory = null) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(database.prepare("SELECT version FROM schema_migrations").all().map((row) => row.version));
  const files = fs.readdirSync(migrationsDirectory).filter((name) => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(name)).sort();
  const pending = files.filter((file) => !applied.has(file));
  // 初回作成には守るべき既存DBがないため、2回目以降の構造変更だけを自動退避する。
  if (pending.length && applied.size) createMigrationBackup(database, backupDirectory);
  for (const file of pending) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`DB更新 ${file} に失敗しました: ${error.message}`);
    }
  }
}

module.exports = { createMigrationBackup, migrate };
