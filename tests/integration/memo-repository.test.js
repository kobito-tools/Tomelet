"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");
const { clearMemoMirror, mirrorPopNoteMemos, popnoteDatabasePath } = require("../../scripts/popnote-memos.js");

const projectRoot = path.resolve(__dirname, "../..");

test("PopNote!のメモを写し、カレンダー・検索・ファイルへ反映する（同じファイルは本体の登録に結び付ける）", () => {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-memo-"));
  fs.mkdirSync(path.dirname(popnoteDatabasePath(basePath)), { recursive: true });
  const database = openDatabase(path.join(basePath, "tomelet.sqlite3"), projectRoot);
  const popnote = openDatabase(popnoteDatabasePath(basePath), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    // 共有タグは両方のDBに同じIDで入っている（tag-store.jsで同期済み）。
    for (const target of [database, popnote]) target.prepare("INSERT INTO tags(id, category_id, name) VALUES ('tag-idea', 'other', '思いつき')").run();
    const tomeletFile = repository.createManagedFile("base", "notes/idea.pdf");
    const createdAt = new Date(2026, 8, 23, 14, 5, 7).toISOString();
    const memoId = "memo-00000000-0000-4000-8000-000000000001", deletedId = "memo-00000000-0000-4000-8000-000000000002";
    popnote.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at) VALUES (?, '会議メモ', '<b>会議</b>', '会議の内容', ?, ?)").run(memoId, createdAt, createdAt);
    popnote.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at, deleted_at) VALUES (?, '消したメモ', '', '', ?, ?, ?)").run(deletedId, createdAt, createdAt, createdAt);
    popnote.prepare("INSERT INTO memo_tags(memo_id, tag_id) VALUES (?, 'tag-idea')").run(memoId);
    popnote.prepare("INSERT INTO managed_files(id, root_id, relative_path, name, extension, created_at, updated_at) VALUES ('managed-file-popnote', 'base', 'notes/idea.pdf', 'idea.pdf', 'pdf', ?, ?)").run(createdAt, createdAt);
    popnote.prepare("INSERT INTO memo_managed_files(memo_id, managed_file_id) VALUES (?, 'managed-file-popnote')").run(memoId);

    assert.equal(mirrorPopNoteMemos(database, basePath), 1, "削除済みのメモは写さない");
    const event = repository.calendarMonth("2026-09").find((item) => item.id === memoId);
    assert.equal(event.eventType, "memo");
    assert.equal(event.occurredAt, "2026-09-23T14:05:07");
    assert.deepEqual(event.tagIds, ["tag-idea"]);
    assert.equal(repository.search("会議").memos.length, 1);
    assert.equal(repository.listMemos({ query: "思いつき" }).length, 1);
    assert.deepEqual(repository.fileById(tomeletFile.id).memos.map((item) => item.id), [memoId]);
    assert.ok(repository.fileById(tomeletFile.id).tagIds.includes("tag-idea"));
    assert.equal(repository.listTrash().length, 0);

    // 写し直しても重複しない。表示をやめると写しを空にする。
    mirrorPopNoteMemos(database, basePath);
    assert.equal(repository.listMemos().length, 1);
    clearMemoMirror(database);
    assert.equal(repository.calendarMonth("2026-09").some((item) => item.id === memoId), false);
    assert.deepEqual(repository.integrity().foreignKeys, []);
  } finally {
    database.close();
    popnote.close();
    fs.rmSync(basePath, { recursive: true, force: true });
  }
});
