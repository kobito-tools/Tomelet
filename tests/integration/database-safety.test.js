"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { migrate } = require("../../scripts/database/migrate.js");
const { createVerifiedBackup } = require("../../scripts/database/backup.js");

const sourceMigrations = path.resolve(__dirname, "../../migrations");

test("DB構造を更新する前に検証可能な自動バックアップを作る", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-migration-"));
  const migrations = path.join(directory, "migrations");
  const backups = path.join(directory, "backups");
  const databasePath = path.join(directory, "ticktocktome.sqlite3");
  fs.cpSync(sourceMigrations, migrations, { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    migrate(database, migrations, backups);
    const now = new Date().toISOString();
    database.prepare("INSERT INTO journal_entries(id, entry_date, title, body_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("journal-backup-test", "2026-09-11", "退避対象", "本文", now, now);
    fs.writeFileSync(path.join(migrations, "003_test.sql"), "CREATE TABLE migration_test(id INTEGER PRIMARY KEY) STRICT;\n");
    migrate(database, migrations, backups);
    const files = fs.readdirSync(backups);
    assert.equal(files.length, 1);
    const backup = new DatabaseSync(path.join(backups, files[0]), { readOnly: true });
    try {
      assert.equal(backup.prepare("SELECT count(*) AS count FROM journal_entries").get().count, 1);
      assert.throws(() => backup.prepare("SELECT * FROM migration_test").all(), /no such table/);
    } finally { backup.close(); }
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("手動バックアップも元DBと独立して読み戻せる", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-backup-"));
  const databasePath = path.join(directory, "source.sqlite3");
  const backups = path.join(directory, "backups");
  fs.mkdirSync(backups);
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE sample(value TEXT) STRICT; INSERT INTO sample VALUES ('preserved')");
  database.close();
  try {
    const target = await createVerifiedBackup(databasePath, backups, "test");
    const restored = new DatabaseSync(target, { readOnly: true });
    try { assert.equal(restored.prepare("SELECT value FROM sample").get().value, "preserved"); }
    finally { restored.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
