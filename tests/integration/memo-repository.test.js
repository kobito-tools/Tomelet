"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");
const { clearMemoMirror, companionUploadPath, memoSource, mirrorCompanionMemos, mirrorPopNoteMemos, pastephantDatabasePath, popnoteDatabasePath } = require("../../scripts/popnote-memos.js");

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

test("Pastephantから残した日ごとのメモも、PopNote!のメモと一緒に写す（開くアプリと画像の置き場所を覚える）", () => {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-pastephant-"));
  for (const file of [popnoteDatabasePath(basePath), pastephantDatabasePath(basePath)]) fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = openDatabase(path.join(basePath, "tomelet.sqlite3"), projectRoot);
  const popnote = openDatabase(popnoteDatabasePath(basePath), projectRoot);
  const pastephant = openDatabase(pastephantDatabasePath(basePath), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    for (const target of [database, pastephant]) target.prepare("INSERT INTO tags(id, category_id, name) VALUES ('tag-paper', 'other', '論文')").run();
    const createdAt = new Date(2026, 8, 28, 9, 0, 0).toISOString();
    const popnoteId = "memo-00000000-0000-4000-8000-000000000011", pastephantId = "memo-00000000-0000-4000-8000-000000000012";
    popnote.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at) VALUES (?, 'メモ', 'メモ', 'メモ', ?, ?)").run(popnoteId, createdAt, createdAt);
    pastephant.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at) VALUES (?, '09月28日のクリップ', '<div>arxiv</div>', 'arxiv の論文', ?, ?)").run(pastephantId, createdAt, createdAt);
    pastephant.prepare("INSERT INTO memo_tags(memo_id, tag_id) VALUES (?, 'tag-paper')").run(pastephantId);
    pastephant.prepare("INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES ('upload-00000000-0000-4000-8000-000000000013', 'clip.png', 'クリップ.png', 'image/png', 3, ?)").run(createdAt);
    pastephant.prepare("INSERT INTO memo_uploads(memo_id, upload_id) VALUES (?, 'upload-00000000-0000-4000-8000-000000000013')").run(pastephantId);
    fs.mkdirSync(path.join(basePath, ".kobito-tools", "Pastephant", "uploads"), { recursive: true });
    fs.writeFileSync(path.join(basePath, ".kobito-tools", "Pastephant", "uploads", "clip.png"), "png");

    assert.equal(mirrorCompanionMemos(database, basePath, ["popnote", "pastephant"]), 2);
    assert.equal(memoSource(pastephantId), "pastephant");
    assert.equal(memoSource(popnoteId), "popnote");
    assert.equal(repository.search("arxiv").memos.length, 1);
    assert.deepEqual(repository.calendarMonth("2026-09").find((item) => item.id === pastephantId).tagIds, ["tag-paper"]);
    assert.equal(companionUploadPath(basePath, "clip.png"), path.join(basePath, ".kobito-tools", "Pastephant", "uploads", "clip.png"));
    assert.equal(companionUploadPath(basePath, "../clip.png"), null, "ほかの場所のファイルは探さない");

    // Pastephantだけ表示をやめると、PopNote!のメモだけが残る。
    assert.equal(mirrorCompanionMemos(database, basePath, ["popnote"]), 1);
    assert.deepEqual(repository.listMemos().map((item) => item.id), [popnoteId]);
    assert.deepEqual(repository.integrity().foreignKeys, []);
  } finally {
    database.close();
    popnote.close();
    pastephant.close();
    fs.rmSync(basePath, { recursive: true, force: true });
  }
});
