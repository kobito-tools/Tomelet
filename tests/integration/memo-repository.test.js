"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");
const { validateMemo } = require("../../scripts/services/memo-service.js");

const projectRoot = path.resolve(__dirname, "../..");

test("メモを保存し、カレンダー・検索・ファイル・ゴミ箱へ反映する", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-memo-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    const tag = repository.findOrCreateTagByName("思いつき");
    assert.equal(tag.categoryId, "other");
    assert.equal(tag.created, true);
    assert.equal(repository.findOrCreateTagByName("思いつき").id, tag.id);

    const file = repository.createManagedFile("files", "notes/idea.pdf");
    const createdAt = new Date(2026, 8, 23, 14, 5, 7).toISOString();
    const memo = repository.createMemo(validateMemo({ createdAt, bodyHtml: "<div>会議の<b>メモ</b></div>", tagIds: [tag.id], managedFileIds: [file.id] }));
    assert.equal(memo.title, "09月23日14時05分07秒のノート");
    assert.equal(memo.createdAt, createdAt);
    assert.deepEqual(memo.tagIds, [tag.id]);
    assert.equal(memo.files[0].relativePath, "notes/idea.pdf");

    const event = repository.calendarMonth("2026-09").find((item) => item.id === memo.id);
    assert.equal(event.eventType, "memo");
    assert.equal(event.occurredAt, "2026-09-23T14:05:07");
    assert.deepEqual(event.tagIds, [tag.id]);
    assert.equal(repository.search("会議").memos.length, 1);
    assert.equal(repository.listMemos({ query: "思いつき" }).length, 1);
    assert.deepEqual(repository.fileById(file.id).memos.map((item) => item.id), [memo.id]);
    assert.ok(repository.fileById(file.id).tagIds.includes(tag.id));

    const updated = repository.updateMemo(memo.id, validateMemo({ title: "会議メモ", bodyHtml: "更新", tagIds: [], revision: 1 }, true));
    assert.equal(updated.revision, 2);
    assert.equal(updated.title, "会議メモ");
    assert.deepEqual(updated.files, []);
    assert.throws(() => repository.updateMemo(memo.id, validateMemo({ title: "古い画面", revision: 1 }, true)), /再読み込み/);

    repository.deleteMemo(memo.id, 2);
    assert.equal(repository.memoById(memo.id), null);
    assert.equal(repository.calendarMonth("2026-09").some((item) => item.id === memo.id), false);
    const trashed = repository.listTrash().find((item) => item.id === memo.id);
    assert.equal(trashed.entityType, "memo");
    assert.equal(repository.restoreMemo(memo.id, trashed.revision).deletedAt, null);
    repository.deleteMemo(memo.id, trashed.revision + 1);
    repository.purgeMemo(memo.id, trashed.revision + 2);
    assert.equal(repository.memoById(memo.id, true), null);
    assert.deepEqual(repository.integrity().foreignKeys, []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
