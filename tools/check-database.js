"use strict";

const path = require("node:path");
const { openDatabase } = require("../scripts/database/connection.js");
const { ensurePrivateDirectories, pathsFor } = require("../scripts/settings.js");

const projectRoot = path.resolve(__dirname, "..");
const runtimePaths = pathsFor();
ensurePrivateDirectories(runtimePaths);
const database = openDatabase(runtimePaths.databasePath, projectRoot);
const integrity = database.prepare("PRAGMA integrity_check").all();
const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
database.close();
console.log(JSON.stringify({ integrity, foreignKeys, ok: integrity.length === 1 && integrity[0].integrity_check === "ok" && foreignKeys.length === 0 }, null, 2));
if (foreignKeys.length || integrity[0]?.integrity_check !== "ok") process.exitCode = 1;
