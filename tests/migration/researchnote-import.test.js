"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { importResearchNote } = require("../../tools/import-researchnote-json.js");

test("ResearchNote JSONを原本変更なしで移行し、全レコードを保全する", () => {
  const sourceDirectory = path.resolve(__dirname, "../fixtures/researchnote");
  const before = fs.readFileSync(path.join(sourceDirectory, "research-log.json"), "utf8");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-import-"));
  const databasePath = path.join(directory, "ticktocktome.sqlite3");
  try {
    const result = importResearchNote({ sourceDirectory, databasePath, rootId: "documents" });
    assert.equal(result.journals, 1);
    assert.equal(result.activitiesArchived, 1);
    assert.equal(result.papersArchived, 1);
    assert.equal(result.files, 1);
    assert.equal(fs.readFileSync(path.join(sourceDirectory, "research-log.json"), "utf8"), before);
    const database = new DatabaseSync(databasePath, { readOnly: true });
    assert.equal(database.prepare("SELECT count(*) AS count FROM legacy_import_records").get().count, 5);
    assert.equal(database.prepare("SELECT count(*) AS count FROM journal_entries").get().count, 1);
    database.close();
    assert.equal(importResearchNote({ sourceDirectory, databasePath, rootId: "documents" }).skipped, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
