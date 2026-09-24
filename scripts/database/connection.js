"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { migrate } = require("./migrate.js");

function openDatabase(databasePath, projectRoot, backupDirectory = null) {
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  migrate(database, path.join(projectRoot, "migrations"), backupDirectory);
  return database;
}

function transaction(database, action) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const value = action();
    database.exec("COMMIT");
    return value;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

module.exports = { openDatabase, transaction };
