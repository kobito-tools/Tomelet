"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");
const dataset = require("../../scripts/dataset.js");
const { readTagsFile, syncTags } = require("../../scripts/tag-store.js");

const projectRoot = path.resolve(__dirname, "../..");

function temporaryDirectory(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
}

function tagNames(database) {
  return Object.fromEntries(database.prepare("SELECT id, name, archived_at AS archivedAt FROM tags ORDER BY id").all().map((row) => [row.id, row.archivedAt ? `${row.name}（アーカイブ）` : row.name]));
}

test("共有タグはtags.jsonを介して両アプリのDBへ広がり、変更はrevisionの大きい方を採る", () => {
  const basePath = temporaryDirectory("kobito-tags-");
  const tomelet = openDatabase(path.join(basePath, "tomelet.sqlite3"), projectRoot);
  const popnote = openDatabase(path.join(basePath, "popnote.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(tomelet);
    repository.createTag({ id: "tag-study", categoryId: "field", name: "研究", description: "", displayOrder: 1 });
    assert.deepEqual(syncTags(tomelet, basePath), { changedDatabase: false, changedFile: true });
    assert.deepEqual(syncTags(popnote, basePath), { changedDatabase: true, changedFile: false });
    assert.equal(tagNames(popnote)["tag-study"], "研究");

    // PopNote!側でアーカイブ（revisionが上がる）→ 本体へ反映される。
    popnote.prepare("UPDATE tags SET archived_at = ?, revision = revision + 1 WHERE id = 'tag-study'").run(new Date().toISOString());
    syncTags(popnote, basePath);
    syncTags(tomelet, basePath);
    assert.equal(tagNames(tomelet)["tag-study"], "研究（アーカイブ）");

    // 名前の入れ替えも一意制約に触れずに反映できる。
    repository.createTag({ id: "tag-a", categoryId: "other", name: "甲", description: "", displayOrder: 1 });
    repository.createTag({ id: "tag-b", categoryId: "other", name: "乙", description: "", displayOrder: 2 });
    syncTags(tomelet, basePath); syncTags(popnote, basePath);
    popnote.exec("UPDATE tags SET name = 'x' WHERE id = 'tag-a'; UPDATE tags SET name = '甲', revision = revision + 1 WHERE id = 'tag-b'; UPDATE tags SET name = '乙', revision = revision + 1 WHERE id = 'tag-a'");
    syncTags(popnote, basePath); syncTags(tomelet, basePath);
    assert.deepEqual([tagNames(tomelet)["tag-a"], tagNames(tomelet)["tag-b"]], ["乙", "甲"]);

    // 両方のアプリで別々に同じ名前のタグを作った場合は、片方に印を付けて両方に残す。
    repository.createTag({ id: "tag-t1", categoryId: "other", name: "会議", description: "", displayOrder: 3 });
    popnote.prepare("INSERT INTO tags(id, category_id, name) VALUES ('tag-p1', 'other', '会議')").run();
    syncTags(tomelet, basePath); syncTags(popnote, basePath); syncTags(tomelet, basePath);
    assert.deepEqual(tagNames(tomelet), tagNames(popnote));
    assert.equal(tagNames(tomelet)["tag-p1"], "会議");
    assert.equal(tagNames(tomelet)["tag-t1"], "会議 (g-t1)");
    assert.deepEqual(syncTags(tomelet, basePath), { changedDatabase: false, changedFile: false }, "一度そろえば変化しない");
    assert.equal(readTagsFile(path.join(basePath, ".kobito-tools", "Tags", "tags.json")).tags.length, tomelet.prepare("SELECT count(*) AS count FROM tags").get().count);
  } finally {
    tomelet.close();
    popnote.close();
    fs.rmSync(basePath, { recursive: true, force: true });
  }
});

// 旧形式（本体とPopNote!が1つのDBを共有していた .TickTockTome/）を作る。
function createLegacyLayout(basePath) {
  const legacy = path.join(basePath, ".TickTockTome");
  for (const name of ["database", "uploads", "backups"]) fs.mkdirSync(path.join(legacy, name), { recursive: true });
  fs.writeFileSync(path.join(legacy, "dataset.json"), JSON.stringify({ format: "ticktocktome-dataset", schemaVersion: 1, datasetId: "研究用", createdAt: "2026-09-01T00:00:00.000Z", revision: 3, settings: { fontPreset: "mincho" }, legacyRoots: {} }));
  const database = openDatabase(path.join(legacy, "database", "ticktocktome.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "tag-idea", categoryId: "other", name: "思いつき", description: "", displayOrder: 1 });
    repository.createJournal({ entryDate: "2026-09-27", title: "日記", bodyMarkdown: "", tagIds: ["tag-idea"], projectIds: [], files: [] });
    const now = new Date().toISOString();
    database.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at) VALUES ('memo-1', 'メモ', '<img src=\"/api/v1/uploads/upload-img/content\">', '', ?, ?)").run(now, now);
    database.prepare("INSERT INTO memo_tags(memo_id, tag_id) VALUES ('memo-1', 'tag-idea')").run();
    const file = repository.createManagedFile("base", "notes/a.pdf");
    database.prepare("INSERT INTO memo_managed_files(memo_id, managed_file_id) VALUES ('memo-1', ?)").run(file.id);
    database.prepare("INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES ('upload-img', 'img.png', 'a.png', 'image/png', 3, ?)").run(now);
    database.prepare("INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES ('upload-pdf', 'doc.pdf', 'doc.pdf', 'application/pdf', 3, ?)").run(now);
    database.prepare("INSERT INTO memo_uploads(memo_id, upload_id) VALUES ('memo-1', 'upload-img')").run();
  } finally { database.close(); }
  fs.writeFileSync(path.join(legacy, "uploads", "img.png"), "png");
  fs.writeFileSync(path.join(legacy, "uploads", "doc.pdf"), "pdf");
  return legacy;
}

test("旧.TickTockTomeは、メモをPopNote/、タグをTags/、残りをTomelet/へ分けて移行し、旧フォルダを残す", () => {
  const basePath = temporaryDirectory("kobito-migrate-");
  try {
    const legacy = createLegacyLayout(basePath);
    const before = dataset.readDataset(basePath);
    assert.equal(before.legacyLayout, true);
    assert.equal(before.datasetId, "研究用");

    const summary = dataset.migrateLegacyLayout(basePath, { projectRoot });
    assert.deepEqual([summary.datasetId, summary.memos, summary.tags > 0], ["研究用", 1, true]);
    assert.equal(fs.existsSync(legacy), false);
    assert.ok(fs.existsSync(`${legacy}.migrated`), "旧フォルダは名前を変えて残す");
    const after = dataset.readDataset(basePath);
    assert.deepEqual([after.datasetId, after.revision, after.settings.fontPreset, after.legacyLayout], ["研究用", 3, "mincho", undefined]);

    const kobito = path.join(basePath, ".kobito-tools");
    const tomelet = openDatabase(path.join(kobito, "Tomelet", "database", "ticktocktome.sqlite3"), projectRoot);
    try {
      assert.equal(tomelet.prepare("SELECT count(*) AS count FROM memos").get().count, 0, "本体のDBからメモを外す");
      assert.equal(tomelet.prepare("SELECT count(*) AS count FROM journal_tags").get().count, 1);
    } finally { tomelet.close(); }
    const popnote = openDatabase(path.join(kobito, "PopNote", "database", "popnote.sqlite3"), projectRoot);
    try {
      assert.equal(popnote.prepare("SELECT title FROM memos").get().title, "メモ");
      assert.equal(popnote.prepare("SELECT tag_id AS tagId FROM memo_tags").get().tagId, "tag-idea");
      assert.equal(popnote.prepare("SELECT relative_path AS relativePath FROM managed_files").get().relativePath, "notes/a.pdf");
      assert.deepEqual(popnote.prepare("SELECT id FROM managed_uploads").all().map((row) => row.id), ["upload-img"]);
      assert.equal(popnote.prepare("SELECT count(*) AS count FROM journal_entries").get().count, 0, "日記はPopNote!へ写さない");
    } finally { popnote.close(); }
    assert.equal(fs.readFileSync(path.join(kobito, "PopNote", "uploads", "img.png"), "utf8"), "png");
    assert.equal(fs.existsSync(path.join(kobito, "PopNote", "uploads", "doc.pdf")), false);
    assert.equal(fs.readFileSync(path.join(kobito, "Tomelet", "uploads", "doc.pdf"), "utf8"), "pdf");
    const tags = readTagsFile(path.join(kobito, "Tags", "tags.json"));
    assert.ok(tags.tags.some((tag) => tag.id === "tag-idea" && tag.name === "思いつき"));
    assert.ok(tags.categories.some((category) => category.id === "other"));
    assert.equal(fs.readdirSync(basePath).some((name) => name.includes("creating")), false);
  } finally { fs.rmSync(basePath, { recursive: true, force: true }); }
});

test("旧形式が別のPCやPopNote!で使用中なら移行しない", () => {
  const basePath = temporaryDirectory("kobito-migrate-lock-");
  try {
    const legacy = createLegacyLayout(basePath);
    const lock = { app: "popnote", machineId: "popnote-x", hostname: "another-mac.local", pid: 1, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    fs.writeFileSync(path.join(legacy, "lock.json"), JSON.stringify(lock));
    assert.throws(() => dataset.migrateLegacyLayout(basePath, { projectRoot }), (error) => error.statusCode === 423);
    // 同じPCでも、動いているPopNote!の印があれば移行しない。
    fs.writeFileSync(path.join(legacy, "lock.json"), JSON.stringify({ ...lock, hostname: os.hostname(), pid: process.ppid }));
    assert.throws(() => dataset.migrateLegacyLayout(basePath, { projectRoot }), (error) => error.statusCode === 423);
    assert.ok(fs.existsSync(path.join(legacy, "dataset.json")));
    assert.equal(fs.existsSync(path.join(basePath, ".kobito-tools")), false);
    // 期限切れの印なら移行する。
    fs.writeFileSync(path.join(legacy, "lock.json"), JSON.stringify({ ...lock, heartbeatAt: new Date(Date.now() - dataset.LOCK_STALE_MS - 1000).toISOString() }));
    assert.equal(dataset.migrateLegacyLayout(basePath, { projectRoot }).memos, 1);
  } finally { fs.rmSync(basePath, { recursive: true, force: true }); }
});
