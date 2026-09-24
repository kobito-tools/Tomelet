"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");

const projectRoot = path.resolve(__dirname, "../..");

test("日記の作成・検索・競合検知・削除・復元を一連で処理できる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-test-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    const created = repository.createJournal({ entryDate: "2026-09-10", title: "Tick Tock Tome設計", bodyMarkdown: "SQLiteで保存する", tagIds: [], projectIds: [], files: [] });
    assert.equal(created.revision, 1);
    assert.equal(repository.journalByDate("2026-09-10").id, created.id);
    assert.equal(repository.search("SQLite").journals.length, 1);

    const updated = repository.updateJournal(created.id, { entryDate: created.entryDate, title: "更新した題名", bodyMarkdown: created.bodyMarkdown, tagIds: [], projectIds: [], files: [], revision: 1 });
    assert.equal(updated.revision, 2);
    assert.throws(() => repository.updateJournal(created.id, { ...updated, tagIds: [], projectIds: [], files: [], revision: 1 }), /再読み込み/);

    repository.deleteJournal(created.id, 2);
    assert.equal(repository.journalById(created.id), null);
    const trashed = repository.listTrash()[0];
    assert.equal(trashed.id, created.id);
    const restored = repository.restoreJournal(created.id, trashed.revision);
    assert.equal(restored.deletedAt, null);
    assert.deepEqual(repository.integrity().foreignKeys, []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("同じ日付の日記を2件作成できない", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-test-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    const input = { entryDate: "2026-09-10", title: "1件目", bodyMarkdown: "", tagIds: [], projectIds: [], files: [] };
    repository.createJournal(input);
    assert.throws(() => repository.createJournal({ ...input, title: "2件目" }), /UNIQUE/);
    assert.equal(repository.dashboard().totals.journals, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("外部アプリの再送は重複せず、古い版で上書きしない", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-test-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    const source = { id: "logger", name: "Test Logger" };
    const base = { externalId: "event-1", startedAt: "2026-09-10T10:00:00Z", endedAt: null, applicationName: "Editor", windowTitle: "New title", rootId: null, relativePath: null, projectName: "Sample", sourceRevision: 2, sourceUpdatedAt: null };
    repository.upsertActivityBatch(source, [base]);
    repository.upsertActivityBatch(source, [{ ...base, windowTitle: "Old title", sourceRevision: 1 }]);
    const row = database.prepare("SELECT window_title AS title, count(*) OVER () AS count FROM activity_events").get();
    assert.equal(row.title, "New title");
    assert.equal(row.count, 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("関連ファイルの内部IDは日記編集後も維持される", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-test-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    const created = repository.createJournal({ entryDate: "2026-09-11", title: "ファイル参照", bodyMarkdown: "", tagIds: [], projectIds: [], files: [{ id: "file-stable", rootId: "documents", relativePath: "notes/a.txt", targetType: "file", displayName: "A", note: "" }] });
    const updated = repository.updateJournal(created.id, { ...created, title: "編集後", revision: created.revision });
    assert.equal(updated.files[0].id, "file-stable");
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("カレンダーと作業ツリー用に日記・タグを取得できる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-test-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "design", categoryId: "other", name: "設計", description: "", displayOrder: 1 });
    repository.createJournal({ entryDate: "2026-09-11", title: "対象月", bodyMarkdown: "", tagIds: ["design"], projectIds: [], files: [] });
    repository.createJournal({ entryDate: "2026-08-31", title: "前月", bodyMarkdown: "", tagIds: [], projectIds: [], files: [] });
    assert.deepEqual(repository.calendarMonth("2026-09").map((item) => item.title), ["対象月"]);
    const tree = repository.workTree();
    assert.deepEqual(tree.find((item) => item.title === "対象月").tagIds, ["design"]);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("タグをアーカイブしても既存記録との関連を保ち、復元できる",()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"ticktocktome-tag-archive-"));
  const database=openDatabase(path.join(directory,"test.sqlite3"),projectRoot);
  try{
    const repository=new SqliteRepository(database);
    const tag=repository.createTag({id:"finished-project",categoryId:"project",name:"完了案件",description:"",displayOrder:1});
    const journal=repository.createJournal({entryDate:"2026-09-17",title:"記録",bodyMarkdown:"",tagIds:[tag.id],projectIds:[],files:[]});
    const archived=repository.setTagArchived(tag.id,true,1);
    assert.ok(archived.archivedAt);assert.equal(repository.listTags().length,0);
    repository.updateJournal(journal.id,{...journal,title:"編集後",tagIds:[],revision:journal.revision});
    assert.deepEqual(repository.journalById(journal.id).tagIds,[tag.id]);
    repository.setTagArchived(tag.id,false,archived.revision);
    assert.equal(repository.listTags()[0].id,tag.id);
  }finally{database.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test("書籍・教科書・論文を共通モデルで作成・編集・分類できる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-library-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "reading", categoryId: "other", name: "読書", description: "", displayOrder: 1 });
    const journal = repository.createJournal({ entryDate: "2026-09-11", title: "読書メモ", bodyMarkdown: "", tagIds: ["reading"], projectIds: [], files: [] });
    const bibtexCode = "@article{Author2025Example,\n  title = {Example Paper}\n}";
    const created = repository.createLibraryItem({ itemType: "paper", title: "Example Paper", authors: ["A. Author"], year: 2025, publication: "Example Journal", status: "unread", priority: 5, favorite: true, keywords: ["archive"], doi: "10.5555/example.1", bibtexCode, takeawayMarkdown: "$x^2$", url: "https://example.com/paper", tagIds: ["reading"], journalIds: [journal.id] });
    assert.deepEqual(repository.listLibraryItems("paper")[0].tagIds, ["reading"]);
    assert.deepEqual(created.journalIds, [journal.id]);
    assert.equal(created.favorite, true);
    assert.deepEqual(created.keywords, ["archive"]);
    assert.equal(created.bibtexCode, bibtexCode);
    const updated = repository.updateLibraryItem(created.id, { ...created, status: "reading", revision: created.revision });
    assert.equal(updated.status, "reading");
    repository.deleteLibraryItem(updated.id, updated.revision);
    assert.equal(repository.libraryItemById(updated.id), null);
    const trashed = repository.listTrash().find((item) => item.id === updated.id);
    assert.equal(trashed.entityType, "library");
    const restored = repository.restoreLibraryItem(updated.id, trashed.revision);
    assert.equal(restored.status, "reading");
    repository.deleteLibraryItem(restored.id, restored.revision);
    const deletedAgain = repository.listTrash().find((item) => item.id === restored.id);
    repository.purgeLibraryItem(restored.id, deletedAgain.revision);
    assert.equal(database.prepare("SELECT count(*) AS count FROM library_items WHERE id = ?").get(restored.id).count, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ファイル一覧は保存済み情報だけを読み、索引のタグを更新できる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-files-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "reference", categoryId: "other", name: "参考資料", description: "", displayOrder: 1 });
    repository.upsertFileIndexBatch({ id: "indexer", name: "Test Indexer" }, [{ externalId: "file-1", rootId: "documents", relativePath: "notes/example.pdf", name: "example.pdf", extension: ".pdf", sizeBytes: 100, modifiedAt: null, indexedAt: "2026-09-14T10:00:00Z", sourceRevision: 1, missing: false }]);
    const listed = repository.listFiles();
    assert.equal(listed[0].name, "example.pdf");
    assert.equal(repository.fileCount(), 0);
    assert.equal("modifiedAt" in listed[0], false);
    const updated = repository.updateFileTags(listed[0].id, ["reference"], listed[0].metadataRevision);
    assert.deepEqual(updated.tagIds, ["reference"]);
    assert.throws(() => repository.updateFileTags(updated.id, [], 1), /再読み込み/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("管理ファイルをTodoと時間割へ関連付けて、タグと作業名を逆引きできる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-managed-file-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "project-a", categoryId: "other", name: "Project A", description: "", displayOrder: 1 });
    const file = repository.createManagedFile("files", "notes/plan.md");
    const todo = repository.saveTodo({ title: "計画を書く", dueDate: "2026-09-18", progress: 10, tagIds: ["project-a"], managedFileIds: [file.id], libraryIds: [] });
    const action = repository.createDailyAction({ actionDate: "2026-09-18", startTime: "09:00", endTime: "10:00", action: "計画を整理", location: "", progress: 0, tagIds: ["project-a"], completions: [], todoId: todo.id, fileIds: [], managedFileIds: [file.id], libraryIds: [], uploadIds: [], displayOrder: 1 });
    const listed = repository.listFiles().find((item) => item.id === file.id);
    assert.deepEqual(listed.tagIds, ["project-a"]);
    assert.equal(listed.todos[0].id, todo.id);
    assert.equal(listed.actions[0].id, action.id);
    assert.equal(repository.fileCount(), 1);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("今日の目標を時間・タグ・達成度・完了項目と一緒に保存できる", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-actions-"));
  const database = openDatabase(path.join(directory, "test.sqlite3"), projectRoot);
  try {
    const repository = new SqliteRepository(database);
    repository.createTag({ id: "focus", categoryId: "other", name: "集中", description: "", displayOrder: 1 });
    repository.createManagedUpload({ id: "upload-test", storedName: "test.pdf", originalName: "資料.pdf", mimeType: "application/pdf", sizeBytes: 100, createdAt: "2026-09-14T08:00:00Z" });
    const book = repository.createLibraryItem({ itemType: "book", title: "関連する本", authors: ["著者"], year: null, publication: "", status: "unread", priority: 3, favorite: false, keywords: [], doi: "", bibtexCode: "", takeawayMarkdown: "", url: "", tagIds: [], journalIds: [], coverUploadId: "" });
    const created = repository.createDailyAction({ actionDate: "2026-09-14", startTime: "09:00", endTime: "10:30", action: "設計を進める", location: "自宅", progress: 25, displayOrder: 1, tagIds: ["focus"], completions: ["画面構成を決めた"], fileIds: [], libraryIds: [book.id], uploadIds: ["upload-test"] });
    assert.equal(created.progress, 25);
    assert.deepEqual(created.tagIds, ["focus"]);
    assert.deepEqual(created.completions, ["画面構成を決めた"]);
    assert.deepEqual(created.libraryIds, [book.id]);
    assert.deepEqual(created.uploadIds, ["upload-test"]);
    assert.equal(created.uploads[0].originalName, "資料.pdf");
    const updated = repository.updateDailyAction(created.id, { ...created, progress: 100, completions: [...created.completions, "実装した"], revision: created.revision });
    assert.equal(updated.progress, 100);
    assert.equal(updated.completions.length, 2);
    assert.throws(() => repository.updateDailyAction(created.id, { ...updated, revision: 1 }), /再読み込み/);
    repository.deleteDailyAction(updated.id, updated.revision);
    assert.equal(repository.dailyActionById(updated.id), null);
    assert.deepEqual(repository.integrity().foreignKeys, []);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
