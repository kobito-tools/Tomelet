"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { JournalService, safeRelativePath } = require("../../scripts/services/journal-service.js");

test("safeRelativePathは基準外へ移動するパスを拒否する", () => {
  assert.equal(safeRelativePath("Projects/TickTockTome/note.md"), true);
  assert.equal(safeRelativePath("../private.txt"), false);
  assert.equal(safeRelativePath("/etc/passwd"), false);
  assert.equal(safeRelativePath("C:\\Users\\secret.txt"), false);
});

test("JournalServiceは日記入力を整形する", () => {
  const service = new JournalService(null, { fileRoots: [{ id: "docs" }] });
  const value = service.validate({ entryDate: "2026-09-10", title: "  題名  ", bodyMarkdown: "本文", tagIds: ["one", "one"], projectIds: [], files: [{ rootId: "docs", relativePath: "Folder\\note.md", targetType: "file" }] });
  assert.equal(value.title, "題名");
  assert.deepEqual(value.tagIds, ["one"]);
  assert.equal(value.files[0].relativePath, "Folder/note.md");
});

test("JournalServiceは未登録の基準フォルダを拒否する", () => {
  const service = new JournalService(null, { fileRoots: [] });
  assert.throws(() => service.validate({ entryDate: "2026-09-10", title: "題名", bodyMarkdown: "", files: [{ rootId: "unknown", relativePath: "note.md" }] }), /登録されていない/);
});

test("JournalServiceは実在しない日付と不正な関連IDを拒否する", () => {
  const service = new JournalService({}, { fileRoots: [{ id: "documents" }] });
  assert.throws(() => service.validate({ entryDate: "2026-02-31", title: "不正日付", files: [] }), /実在する/);
  assert.throws(() => service.validate({ entryDate: "2026-02-28", title: "不正ID", files: [{ id: "../outside", rootId: "documents", relativePath: "safe.txt" }] }), /内部ID/);
});
