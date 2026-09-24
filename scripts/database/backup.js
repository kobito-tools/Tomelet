"use strict";

const { backup, DatabaseSync } = require("node:sqlite");
const path = require("node:path");

async function createVerifiedBackup(databasePath, backupDirectory, prefix = "ticktocktome") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupDirectory, `${prefix}-${stamp}.sqlite3`);
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try { await backup(source, destination); } finally { source.close(); }
  const verification = new DatabaseSync(destination, { readOnly: true });
  try {
    const integrity = verification.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("バックアップ後の整合性検査に失敗しました。");
  } finally { verification.close(); }
  return destination;
}

module.exports = { createVerifiedBackup };
