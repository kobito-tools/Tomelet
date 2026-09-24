"use strict";

const { createVerifiedBackup } = require("../scripts/database/backup.js");
const { ensurePrivateDirectories, pathsFor } = require("../scripts/settings.js");

async function main() {
  const runtimePaths = pathsFor();
  ensurePrivateDirectories(runtimePaths);
  const destination = await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory);
  console.log(destination);
}

main().catch((error) => { console.error(`バックアップに失敗しました: ${error.message}`); process.exitCode = 1; });
