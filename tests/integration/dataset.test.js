"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { SqliteRepository } = require("../../scripts/repositories/sqlite-repository.js");
const dataset = require("../../scripts/dataset.js");
const { pathsFor } = require("../../scripts/settings.js");

const projectRoot = path.resolve(__dirname, "../..");

function temporaryDirectory(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), name)));
}

test("基準パス直下の.kobito-toolsへIDと共有設定、Tomelet/へ本体のデータを保存し、既存データは上書きしない", () => {
  const basePath = temporaryDirectory("ticktocktome-dataset-");
  try {
    dataset.createDataset(basePath, { datasetId: " 研究用 ", settings: { fontPreset: "mincho" } });
    const loaded = dataset.readDataset(basePath);
    assert.equal(loaded.datasetId, "研究用");
    assert.equal(loaded.settings.fontPreset, "mincho");
    assert.equal(JSON.parse(fs.readFileSync(path.join(basePath, ".kobito-tools", "dataset.json"), "utf8")).format, "kobito-tools-dataset");
    for (const name of ["database", "backups", "exports", "quarantine", "uploads"]) assert.ok(fs.statSync(path.join(basePath, ".kobito-tools", "Tomelet", name)).isDirectory());
    assert.throws(() => dataset.createDataset(basePath, { datasetId: "別" }), /既に/);
    for (const selected of [".kobito-tools", ".kobito-tools/Tomelet", ".kobito-tools/PopNote", ".TickTockTome"]) assert.equal(dataset.normalizeBasePath(path.join(basePath, selected)), basePath);
    assert.equal(dataset.normalizeBasePath(path.join(basePath, "PopNote")), path.join(basePath, "PopNote"));
    assert.throws(() => dataset.validateDatasetId(""), /1〜60文字/);
  } finally { fs.rmSync(basePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("別のPCが使用中のデータセットは開かず、期限切れや強制時だけ引き継ぐ", () => {
  const basePath = temporaryDirectory("ticktocktome-lock-");
  try {
    dataset.createDataset(basePath, { datasetId: "共有" });
    dataset.acquireLock(basePath, "machine-a-0001");
    assert.throws(() => dataset.acquireLock(basePath, "machine-b-0002"), (error) => error.statusCode === 423 && error.lockHolder.samePc === false);
    const lock = dataset.readLock(basePath);
    fs.writeFileSync(path.join(basePath, ".kobito-tools", "Tomelet", "lock.json"), JSON.stringify({ ...lock, heartbeatAt: new Date(Date.now() - dataset.LOCK_STALE_MS - 1000).toISOString() }));
    assert.equal(dataset.acquireLock(basePath, "machine-b-0002").machineId, "machine-b-0002");
    assert.equal(dataset.acquireLock(basePath, "machine-a-0001", { force: true }).machineId, "machine-a-0001");
    dataset.releaseLock(basePath, "machine-b-0002");
    assert.ok(dataset.readLock(basePath), "他のPCのロックは解除しない");
    dataset.releaseLock(basePath, "machine-a-0001");
    assert.equal(dataset.readLock(basePath), null);
  } finally { fs.rmSync(basePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("旧データを複製し、基準パス内の参照は相対パスへ変換、外の参照は要再リンクにする", async () => {
  const root = temporaryDirectory("ticktocktome-migrate-");
  const machineDirectory = path.join(root, "machine");
  const basePath = path.join(root, "Drive");
  const outside = path.join(root, "Outside");
  for (const directory of [path.join(basePath, "Book"), path.join(basePath, "Paper"), outside]) fs.mkdirSync(directory, { recursive: true });
  const legacyPaths = pathsFor(machineDirectory);
  fs.mkdirSync(legacyPaths.databaseDirectory, { recursive: true });
  const legacyDatabase = openDatabase(legacyPaths.databasePath, projectRoot);
  try {
    const repository = new SqliteRepository(legacyDatabase);
    repository.createReferencedLibraryItem("book", "books", "novel.pdf");
    repository.createReferencedLibraryItem("paper", "papers", "2026/study.pdf");
    repository.createReferencedLibraryItem("book", "old", "lost.pdf");
    const viaFiles = repository.createManagedFile("files", "Book/novel.pdf");
    const viaDrive = repository.createManagedFile("GoogleDrive", "Book/novel.pdf");
    const todo = repository.saveTodo({ title: "読む", dueDate: "2026-09-27", progress: 0, tagIds: [], managedFileIds: [viaDrive.id], libraryIds: [] });
    repository.createJournal({ entryDate: "2026-09-27", title: "日記", bodyMarkdown: "", tagIds: [], projectIds: [], files: [{ rootId: "files", relativePath: "Paper/2026/study.pdf", targetType: "file", displayName: "", note: "" }] });
    assert.ok(viaFiles.id && todo.id);
  } finally { legacyDatabase.close(); }
  const legacy = { contentDirectory: machineDirectory, fileRoots: [
    { id: "files", absolutePath: basePath }, { id: "GoogleDrive", absolutePath: basePath },
    { id: "books", absolutePath: path.join(basePath, "Book") }, { id: "papers", absolutePath: path.join(basePath, "Paper") },
    { id: "old", absolutePath: outside },
  ] };
  try {
    const prefixes = dataset.legacyRootPrefixes(basePath, legacy.fileRoots);
    assert.deepEqual(prefixes, { files: "", GoogleDrive: "", books: "Book", papers: "Paper", old: null });
    dataset.createDataset(basePath, { datasetId: "移行", legacyRoots: prefixes });
    const result = await dataset.migrateLegacyData({ legacy, basePath, machineDataDirectory: machineDirectory, projectRoot });
    assert.equal(result.migrated, true);
    assert.deepEqual(result.unresolvedRootIds, ["old"]);
    const migrated = openDatabase(dataset.datasetPaths(machineDirectory, basePath).databasePath, projectRoot);
    try {
      const library = migrated.prepare("SELECT source_root_id AS rootId, source_relative_path AS relativePath FROM library_items ORDER BY source_relative_path").all().map((row) => ({ ...row }));
      assert.deepEqual(library, [{ rootId: "base", relativePath: "Book/novel.pdf" }, { rootId: "base", relativePath: "Paper/2026/study.pdf" }, { rootId: "old", relativePath: "lost.pdf" }]);
      const managed = migrated.prepare("SELECT id, root_id AS rootId, relative_path AS relativePath FROM managed_files").all();
      assert.equal(managed.length, 1, "同じ実ファイルの重複登録は1件へまとめる");
      assert.equal(migrated.prepare("SELECT managed_file_id AS id FROM todo_managed_files").get().id, managed[0].id);
      assert.equal(migrated.prepare("SELECT relative_path AS relativePath FROM file_links").get().relativePath, "Paper/2026/study.pdf");
      const unresolved = dataset.unresolvedReferences(migrated);
      assert.deepEqual(unresolved.map((item) => [item.kind, item.rootId]), [["library", "old"]]);
      dataset.relinkReference(migrated, "library", unresolved[0].id, "Book/lost.pdf");
      assert.equal(dataset.unresolvedReferences(migrated).length, 0);
    } finally { migrated.close(); }
    assert.ok(fs.existsSync(legacyPaths.databasePath), "旧DBは残す");
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close((error) => error ? reject(error) : resolve(port)); });
  });
}

async function startServer(dataDirectory, setting, env = {}) {
  const port = await reservePort();
  fs.mkdirSync(path.join(dataDirectory, "config"), { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, "config", "setting.json"), JSON.stringify({ schemaVersion: 2, port, ...setting }));
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/server.js")], { cwd: projectRoot, env: { ...process.env, TICKTOCKTOME_DATA_DIR: dataDirectory, ...env }, stdio: ["ignore", "ignore", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/health`)).ok) return { child, base }; } catch { /* 起動中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("テストサーバーが起動しませんでした。");
}

async function stopServer(server) {
  server.child.kill("SIGTERM");
  await new Promise((resolve) => server.child.once("exit", resolve));
}

test("基準パス未設定なら設定待ちで起動し、使用中の基準パスは別のPCから開かない", async () => {
  const root = temporaryDirectory("ticktocktome-dataset-http-");
  const basePath = path.join(root, "base");
  fs.mkdirSync(basePath);
  dataset.createDataset(basePath, { datasetId: "共有データ" });
  const servers = [];
  try {
    const unset = await startServer(path.join(root, "pc-unset"), { machineId: "machine-unset-01" });
    servers.push(unset);
    const setup = await (await fetch(`${unset.base}/api/v1/bootstrap`)).json();
    assert.equal(setup.setupRequired, true);
    assert.equal(setup.setup.status, "unset");
    assert.equal((await fetch(`${unset.base}/api/v1/journals`)).status, 503);

    const first = await startServer(path.join(root, "pc-a"), { machineId: "machine-a-000001", basePath });
    servers.push(first);
    const ready = await (await fetch(`${first.base}/api/v1/bootstrap`)).json();
    assert.equal(ready.dataset.id, "共有データ");
    assert.deepEqual(ready.fileRoots.map((item) => item.id), ["base"]);
    assert.equal(dataset.readLock(basePath).machineId, "machine-a-000001");

    const second = await startServer(path.join(root, "pc-b"), { machineId: "machine-b-000002", basePath });
    servers.push(second);
    const locked = await (await fetch(`${second.base}/api/v1/bootstrap`)).json();
    assert.equal(locked.setup.status, "locked");

    await stopServer(first);
    servers.splice(servers.indexOf(first), 1);
    assert.equal(dataset.readLock(basePath), null, "終了時にロックを解除する");
  } finally {
    for (const server of servers) await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("旧設定の環境で基準パスを選ぶと、IDを付けて移行し、既存データならIDを返して切り替える", async () => {
  const root = temporaryDirectory("ticktocktome-dataset-switch-");
  const machineDirectory = path.join(root, "machine");
  const basePath = path.join(root, "Drive");
  const otherBase = path.join(root, "Other");
  fs.mkdirSync(path.join(basePath, "Book"), { recursive: true });
  fs.mkdirSync(otherBase);
  fs.writeFileSync(path.join(basePath, "Book", "novel.pdf"), "%PDF-1.4\n");
  const legacyPaths = pathsFor(machineDirectory);
  fs.mkdirSync(legacyPaths.databaseDirectory, { recursive: true });
  const legacyDatabase = openDatabase(legacyPaths.databasePath, projectRoot);
  try { new SqliteRepository(legacyDatabase).createReferencedLibraryItem("book", "books", "novel.pdf"); } finally { legacyDatabase.close(); }
  const post = (server, route, body) => fetch(`${server.base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: server.base }, body: JSON.stringify(body) });
  const servers = [];
  try {
    // schemaVersion 1の設定（種類別基準パス）のまま起動する。
    const legacy = await startServer(machineDirectory, { schemaVersion: 1, fontPreset: "mincho", fileRoots: [{ id: "books", displayName: "書籍", absolutePath: path.join(basePath, "Book") }] }, { TICKTOCKTOME_TEST_PICK_FOLDER: basePath });
    servers.push(legacy);
    let bootstrap = await (await fetch(`${legacy.base}/api/v1/bootstrap`)).json();
    assert.equal(bootstrap.setup.legacyAvailable, true);
    const chosen = await (await post(legacy, "/api/v1/dataset:choose", { revision: bootstrap.settingsRevision })).json();
    assert.equal(chosen.existing, null);
    const created = await post(legacy, "/api/v1/dataset:apply", { token: chosen.token, revision: bootstrap.settingsRevision, datasetId: "個人", migrateLegacy: true });
    assert.equal(created.status, 200);
    bootstrap = await (await fetch(`${legacy.base}/api/v1/bootstrap`)).json();
    assert.equal(bootstrap.dataset.id, "個人");
    assert.equal(bootstrap.fontPreset, "mincho", "外見設定も引き継ぐ");
    const books = await (await fetch(`${legacy.base}/api/v1/library?type=book`)).json();
    assert.equal(books.items[0].sourceRelativePath, "Book/novel.pdf");
    const machine = JSON.parse(fs.readFileSync(legacyPaths.settingPath, "utf8"));
    assert.equal(machine.basePath, basePath);
    assert.equal(machine.fontPreset, undefined, "共有設定はPC側へ保存しない");
    assert.ok(machine.legacy.migratedAt);
    await stopServer(legacy);
    servers.length = 0;

    // 別のPCで同じフォルダを選ぶと、保存済みのIDを確認に使える。
    const other = await startServer(path.join(root, "pc-b"), { machineId: "machine-b-000002", basePath: otherBase }, { TICKTOCKTOME_TEST_PICK_FOLDER: path.join(basePath, ".kobito-tools") });
    servers.push(other);
    bootstrap = await (await fetch(`${other.base}/api/v1/bootstrap`)).json();
    assert.equal(bootstrap.setup.status, "missing");
    const existing = await (await post(other, "/api/v1/dataset:choose", { revision: bootstrap.settingsRevision })).json();
    assert.deepEqual(existing.existing, { datasetId: "個人" });
    assert.equal(existing.basePath, basePath);
    assert.equal((await post(other, "/api/v1/dataset:apply", { token: existing.token, revision: bootstrap.settingsRevision })).status, 200);
    bootstrap = await (await fetch(`${other.base}/api/v1/bootstrap`)).json();
    assert.equal(bootstrap.dataset.id, "個人");
    const renamed = await fetch(`${other.base}/api/v1/dataset`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: other.base }, body: JSON.stringify({ revision: bootstrap.settingsRevision, datasetId: "個人2" }) });
    assert.equal(renamed.status, 200);
    assert.equal(dataset.readDataset(basePath).datasetId, "個人2");
  } finally {
    for (const server of servers) await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("作成・移行の途中で失敗しても、中途半端な.kobito-toolsを残さない", async () => {
  const basePath = temporaryDirectory("ticktocktome-dataset-fail-");
  try {
    await assert.rejects(dataset.createDatasetWith(basePath, { datasetId: "失敗" }, async (directory) => {
      fs.writeFileSync(path.join(directory, "database", "partial.sqlite3"), "");
      throw new Error("同期エラー");
    }), /同期エラー/);
    assert.deepEqual(fs.readdirSync(basePath), []);
    const { result } = await dataset.createDatasetWith(basePath, { datasetId: "成功" }, async () => "ok");
    assert.equal(result, "ok");
    assert.equal(dataset.readDataset(basePath).datasetId, "成功");
  } finally { fs.rmSync(basePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});

test("PopNote!だけが作ったデータセットでも、本体はIDを引き継いでTomelet/を作って開く", async () => {
  const root = temporaryDirectory("ticktocktome-popnote-only-");
  const basePath = path.join(root, "base");
  fs.mkdirSync(path.join(basePath, ".kobito-tools", "PopNote", "database"), { recursive: true });
  fs.writeFileSync(path.join(basePath, ".kobito-tools", "dataset.json"), JSON.stringify({ format: "kobito-tools-dataset", schemaVersion: 1, datasetId: "メモ帳", createdAt: new Date().toISOString(), revision: 1, settings: {}, legacyRoots: {} }));
  const servers = [];
  try {
    const server = await startServer(path.join(root, "pc"), { machineId: "machine-p-000001", basePath });
    servers.push(server);
    const bootstrap = await (await fetch(`${server.base}/api/v1/bootstrap`)).json();
    assert.equal(bootstrap.dataset.id, "メモ帳");
    assert.ok(fs.existsSync(path.join(basePath, ".kobito-tools", "Tomelet", "database", "ticktocktome.sqlite3")));
    assert.equal(dataset.readLock(basePath).machineId, "machine-p-000001");
  } finally {
    for (const server of servers) await stopServer(server);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
