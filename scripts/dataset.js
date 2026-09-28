"use strict";

// 基準パスを「データセット」として扱う。基準パス直下の .kobito-tools/ に
//   dataset.json（ID・共有設定）、Tomelet/（SQLite・アップロード・バックアップ）、PopNote/（メモ）、Tags/（共有タグ）
// を置き、ファイルは基準パスからの相対パスだけで参照する。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase, transaction } = require("./database/connection.js");
const { createVerifiedBackup } = require("./database/backup.js");
const { APP_DATA_DIRECTORY_NAME, DATASET_DIRECTORY_NAME, LEGACY_DATASET_DIRECTORY_NAME, POPNOTE_DIRECTORY_NAME, TAGS_DIRECTORY_NAME, databasePathIn, datasetDirectoryFor, kobitoDirectoryFor, legacyDatasetDirectoryFor, normalizeSharedSettings, pathsFor, readJsonIfPresent, writeJsonAtomic } = require("./settings.js");
const { TAGS_FORMAT } = require("./tag-store.js");

const DATASET_FORMAT = "kobito-tools-dataset";
const LEGACY_DATASET_FORMAT = "ticktocktome-dataset";
const DATASET_FILE_NAME = "dataset.json";
const LOCK_FILE_NAME = "lock.json";
const BASE_ROOT_ID = "base";
const LOCK_STALE_MS = 2 * 60 * 1000;
const LOCK_HEARTBEAT_MS = 30 * 1000;
const DATASET_SUBDIRECTORIES = ["database", "backups", "exports", "quarantine", "uploads"];

function httpError(message, statusCode, extra = {}) {
  return Object.assign(new Error(message), { statusCode, ...extra });
}

function validateDatasetId(value) {
  const id = String(value ?? "").normalize("NFC").trim();
  if (!id || id.length > 60) throw new Error("IDは1〜60文字で入力してください。");
  if (/[\u0000-\u001f\u007f]/.test(id)) throw new Error("IDに制御文字は使えません。");
  return id;
}

// .kobito-tools（またはその中の各アプリのフォルダ）や旧 .TickTockTome 自体を選んだ場合は、基準パスへ読み替える。
function normalizeBasePath(selected) {
  const resolved = path.resolve(selected), name = path.basename(resolved), parent = path.dirname(resolved);
  if (name === DATASET_DIRECTORY_NAME || name === LEGACY_DATASET_DIRECTORY_NAME) return parent;
  if (path.basename(parent) === DATASET_DIRECTORY_NAME && [APP_DATA_DIRECTORY_NAME, POPNOTE_DIRECTORY_NAME, TAGS_DIRECTORY_NAME].includes(name)) return path.dirname(parent);
  return resolved;
}

function datasetFile(basePath) {
  return path.join(kobitoDirectoryFor(basePath), DATASET_FILE_NAME);
}

function legacyDatasetFile(basePath) {
  return path.join(legacyDatasetDirectoryFor(basePath), DATASET_FILE_NAME);
}

function normalizeLegacyRoots(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([id, prefix]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && (prefix === null || typeof prefix === "string")));
}

// 新しい .kobito-tools が無く、旧 .TickTockTome だけがある場合は legacyLayout: true を付けて返す（開くときに移行する）。
function readDataset(basePath) {
  const raw = readJsonIfPresent(datasetFile(basePath));
  if (raw) {
    if (raw.format !== DATASET_FORMAT) throw new Error("基準パスのTomeletデータを読み取れません。");
    return datasetRecord(raw);
  }
  const legacy = readJsonIfPresent(legacyDatasetFile(basePath));
  if (!legacy) return null;
  if (legacy.format !== LEGACY_DATASET_FORMAT) throw new Error("基準パスのTomeletデータを読み取れません。");
  return { ...datasetRecord(legacy), legacyLayout: true };
}

function datasetRecord(raw) {
  return {
    datasetId: validateDatasetId(raw.datasetId),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    revision: Number.isSafeInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1,
    settings: normalizeSharedSettings(raw.settings || {}),
    legacyRoots: normalizeLegacyRoots(raw.legacyRoots),
  };
}

function writeDataset(basePath, dataset) {
  writeJsonAtomic(datasetFile(basePath), datasetFileRecord(dataset));
}

function datasetFileRecord(dataset) {
  return { format: DATASET_FORMAT, schemaVersion: 1, datasetId: dataset.datasetId, createdAt: dataset.createdAt, revision: dataset.revision, settings: normalizeSharedSettings(dataset.settings), legacyRoots: dataset.legacyRoots || {} };
}

function datasetPaths(machineDataDirectory, basePath) {
  return pathsFor(machineDataDirectory, datasetDirectoryFor(basePath));
}

function ensureDatasetDirectories(basePath) {
  const directory = datasetDirectoryFor(basePath);
  for (const name of DATASET_SUBDIRECTORIES) fs.mkdirSync(path.join(directory, name), { recursive: true, mode: 0o700 });
}

// 作成は一時フォルダ（.kobito-tools-creating-…/）で行い、最後に名前を変えて完成させる。途中で失敗しても中途半端な.kobito-toolsを残さない。
// 一時フォルダの中は完成形と同じ並び（dataset.json と Tomelet/）にする。
function stageDataset(basePath, { datasetId, settings = {}, legacyRoots = {} }) {
  const id = validateDatasetId(datasetId);
  if (!fs.statSync(basePath).isDirectory()) throw new Error("基準パスはフォルダを指定してください。");
  if (fs.existsSync(datasetFile(basePath)) || fs.existsSync(legacyDatasetFile(basePath))) throw httpError("この基準パスには既にTomeletのデータがあります。", 409);
  const dataset = { datasetId: id, createdAt: new Date().toISOString(), revision: 1, settings: normalizeSharedSettings(settings), legacyRoots: normalizeLegacyRoots(legacyRoots) };
  return { ...stageDatasetDirectory(basePath, dataset), dataset };
}

// 既存のID・設定のまま一時フォルダを用意する（旧形式からの移行用）。
function stageDatasetDirectory(basePath, dataset) {
  const stagingDirectory = path.join(basePath, `${DATASET_DIRECTORY_NAME}-creating-${randomUUID()}`);
  for (const name of DATASET_SUBDIRECTORIES) fs.mkdirSync(path.join(stagingDirectory, APP_DATA_DIRECTORY_NAME, name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(stagingDirectory, DATASET_FILE_NAME), `${JSON.stringify(datasetFileRecord(dataset), null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { stagingDirectory };
}

function commitStagedDataset(basePath, stagingDirectory) {
  // 同時に別の場所から作成された場合は上書きしない（renameは既存の空でないフォルダを置き換えない）。
  if (fs.existsSync(datasetFile(basePath)) || fs.existsSync(legacyDatasetFile(basePath))) throw httpError("この基準パスには既にTomeletのデータがあります。", 409);
  const kobitoDirectory = kobitoDirectoryFor(basePath);
  if (!fs.existsSync(kobitoDirectory)) { fs.renameSync(stagingDirectory, kobitoDirectory); return; }
  // dataset.json の無い .kobito-tools（作成途中で止まったものなど）がある場合は、中身だけを移して完成させる。
  if (fs.existsSync(datasetDirectoryFor(basePath))) throw httpError("この基準パスの.kobito-toolsにTomeletのフォルダが残っています。中身を確認してください。", 409);
  fs.renameSync(path.join(stagingDirectory, APP_DATA_DIRECTORY_NAME), datasetDirectoryFor(basePath));
  fs.writeFileSync(datasetFile(basePath), fs.readFileSync(path.join(stagingDirectory, DATASET_FILE_NAME)), { flag: "wx", mode: 0o600 });
  fs.rmSync(stagingDirectory, { recursive: true, force: true });
}

function createDataset(basePath, options) {
  const { stagingDirectory, dataset } = stageDataset(basePath, options);
  try { commitStagedDataset(basePath, stagingDirectory); }
  catch (error) { fs.rmSync(stagingDirectory, { recursive: true, force: true }); throw error; }
  return dataset;
}

// populate(一時フォルダ)で中身（移行したDBなど）を用意してから完成させる。
async function createDatasetWith(basePath, options, populate) {
  const { stagingDirectory, dataset } = stageDataset(basePath, options);
  try {
    const result = await populate(path.join(stagingDirectory, APP_DATA_DIRECTORY_NAME));
    commitStagedDataset(basePath, stagingDirectory);
    return { dataset, result };
  } catch (error) {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

// ---- 排他ロック：同じデータセットを複数のPCで同時に開かないようにする ----

function lockFile(basePath) {
  return path.join(datasetDirectoryFor(basePath), LOCK_FILE_NAME);
}

function readLock(basePath) {
  try { return readJsonIfPresent(lockFile(basePath)); } catch { return null; }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

// 本体の lock.json は .kobito-tools/Tomelet/ に置く。PopNote!は自分のフォルダに別の印を置くため、互いに干渉しない。
function lockIsActive(lock, machineId, now = Date.now()) {
  if (!lock || typeof lock !== "object") return false;
  const fresh = now - Date.parse(lock.heartbeatAt || "") < LOCK_STALE_MS;
  if (lock.machineId !== machineId) return fresh;
  if (lock.pid === process.pid) return false;
  return fresh && Number.isInteger(lock.pid) && processAlive(lock.pid);
}

function lockHolder(lock, machineId) {
  return { hostname: String(lock?.hostname || "不明なPC").slice(0, 200), heartbeatAt: lock?.heartbeatAt || null, samePc: lock?.machineId === machineId };
}

function writeLock(basePath, machineId, startedAt = new Date().toISOString()) {
  const lock = { machineId, hostname: os.hostname(), pid: process.pid, startedAt, heartbeatAt: new Date().toISOString() };
  writeJsonAtomic(lockFile(basePath), lock);
  return lock;
}

function acquireLock(basePath, machineId, { force = false } = {}) {
  const current = readLock(basePath);
  if (!force && lockIsActive(current, machineId)) throw httpError("このデータは別の場所で使用中です。", 423, { lockHolder: lockHolder(current, machineId) });
  return writeLock(basePath, machineId);
}

function ownsLock(lock, machineId) {
  return lock?.machineId === machineId && lock?.pid === process.pid;
}

function releaseLock(basePath, machineId) {
  if (ownsLock(readLock(basePath), machineId)) fs.rmSync(lockFile(basePath), { force: true });
}

// 定期的に使用中の印を更新する。別のPCが強制的に開いた場合はonLostで知らせる。
function startLockHeartbeat(basePath, machineId, startedAt, onLost) {
  const timer = setInterval(() => {
    const current = readLock(basePath);
    if (current && !ownsLock(current, machineId)) { clearInterval(timer); onLost(lockHolder(current, machineId)); return; }
    try { writeLock(basePath, machineId, startedAt); } catch { /* 一時的に書けない場合は次回に再試行 */ }
  }, LOCK_HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

// ---- フォルダアイコン：アプリと同じアイコンを付ける（失敗しても動作には影響しない） ----

function applyFolderIcon(basePath, projectRoot) {
  const directory = datasetDirectoryFor(basePath);
  try {
    if (process.platform === "darwin") {
      if (fs.existsSync(path.join(directory, "Icon\r"))) return;
      const script = "ObjC.import('AppKit');function run(argv){const image=$.NSImage.alloc.initWithContentsOfFile(argv[0]);return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image,argv[1],0);}";
      spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, path.join(projectRoot, "assets", "icon", "app-icon.icns"), directory], { stdio: "ignore", shell: false }).on("error", () => {}).unref();
    } else if (process.platform === "win32") {
      const iconPath = path.join(directory, "folder-icon.ico"), iniPath = path.join(directory, "desktop.ini");
      if (fs.existsSync(iniPath)) return;
      fs.copyFileSync(path.join(projectRoot, "assets", "icon", "app-icon.ico"), iconPath);
      fs.writeFileSync(iniPath, "[.ShellClassInfo]\r\nIconResource=folder-icon.ico,0\r\n", { mode: 0o600 });
      const attrib = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "attrib.exe");
      for (const target of [iniPath, iconPath]) spawnSync(attrib, ["+h", "+s", target], { stdio: "ignore", windowsHide: true, shell: false });
      // Windowsでは先頭のドットでは隠れないため、隠し属性も付ける。+sはdesktop.iniを有効にするために必要。
      spawnSync(attrib, ["+h", "+s", directory], { stdio: "ignore", windowsHide: true, shell: false });
      spawnSync(attrib, ["+h", kobitoDirectoryFor(basePath)], { stdio: "ignore", windowsHide: true, shell: false });
    }
  } catch { /* アイコンは装飾なので無視する */ }
}

// ---- 旧設定（種類別基準パス）からの移行 ----

function realOrResolved(target) {
  try { return fs.realpathSync(target); } catch { return path.resolve(target); }
}

// 旧基準パスごとに、新しい基準パスからの接頭辞を求める。基準パスの外にあるものはnull。
function legacyRootPrefixes(basePath, fileRoots = []) {
  const base = realOrResolved(basePath);
  const prefixes = {};
  for (const root of fileRoots) {
    if (!root || typeof root.id !== "string" || typeof root.absolutePath !== "string" || root.id in prefixes) continue;
    const target = realOrResolved(root.absolutePath);
    if (target === base) prefixes[root.id] = "";
    else if (target.startsWith(`${base}${path.sep}`)) prefixes[root.id] = path.relative(base, target).split(path.sep).join("/");
    else prefixes[root.id] = null;
  }
  return prefixes;
}

function joinRelative(prefix, relativePath) {
  return prefix ? `${prefix}/${relativePath}` : relativePath;
}

const managedFileLinkTables = ["daily_action_managed_files", "todo_managed_files", "memo_managed_files"];

function convertManagedFiles(database, rootId, prefix) {
  const rows = database.prepare("SELECT id, relative_path AS relativePath FROM managed_files WHERE root_id = ?").all(rootId);
  const existing = database.prepare("SELECT id FROM managed_files WHERE root_id = ? AND relative_path = ?");
  const update = database.prepare("UPDATE managed_files SET root_id = ?, relative_path = ? WHERE id = ?");
  for (const row of rows) {
    const target = joinRelative(prefix, row.relativePath);
    const survivor = existing.get(BASE_ROOT_ID, target);
    if (!survivor) { update.run(BASE_ROOT_ID, target, row.id); continue; }
    // 同じ実ファイルを別の旧基準パスで登録していた場合は、1件へまとめて関連を付け替える。
    for (const table of managedFileLinkTables) {
      database.prepare(`UPDATE OR IGNORE ${table} SET managed_file_id = ? WHERE managed_file_id = ?`).run(survivor.id, row.id);
      database.prepare(`DELETE FROM ${table} WHERE managed_file_id = ?`).run(row.id);
    }
    database.prepare("DELETE FROM managed_files WHERE id = ?").run(row.id);
  }
}

function convertLegacyReferences(database, prefixes) {
  const joined = "CASE WHEN ? = '' THEN relative_path ELSE ? || '/' || relative_path END";
  const summary = { converted: 0, unresolvedRootIds: [] };
  const ordered = Object.keys(prefixes).sort((a, b) => (a === BASE_ROOT_ID ? -1 : b === BASE_ROOT_ID ? 1 : 0));
  transaction(database, () => {
    for (const rootId of ordered) {
      const prefix = prefixes[rootId];
      if (prefix === null) { summary.unresolvedRootIds.push(rootId); continue; }
      if (rootId === BASE_ROOT_ID && prefix === "") continue;
      database.prepare(`DELETE FROM file_links WHERE root_id = ? AND EXISTS (SELECT 1 FROM file_links other WHERE other.journal_id = file_links.journal_id AND other.root_id = ? AND other.relative_path = (${joined.replaceAll("relative_path", "file_links.relative_path")}))`).run(rootId, BASE_ROOT_ID, prefix, prefix);
      summary.converted += Number(database.prepare(`UPDATE file_links SET root_id = ?, relative_path = ${joined} WHERE root_id = ?`).run(BASE_ROOT_ID, prefix, prefix, rootId).changes);
      summary.converted += Number(database.prepare(`UPDATE file_index_items SET root_id = ?, relative_path = ${joined} WHERE root_id = ?`).run(BASE_ROOT_ID, prefix, prefix, rootId).changes);
      summary.converted += Number(database.prepare(`UPDATE activity_events SET root_id = ?, relative_path = ${joined} WHERE root_id = ? AND relative_path IS NOT NULL`).run(BASE_ROOT_ID, prefix, prefix, rootId).changes);
      summary.converted += Number(database.prepare(`UPDATE library_items SET source_root_id = ?, source_relative_path = ${joined.replaceAll("relative_path", "source_relative_path")} WHERE source_root_id = ? AND source_relative_path IS NOT NULL`).run(BASE_ROOT_ID, prefix, prefix, rootId).changes);
      convertManagedFiles(database, rootId, prefix);
    }
  });
  return summary;
}

// 旧保存先のDB・アップロード・外見設定を、新しいデータセットへ複製して相対パスを変換する。旧データは消さない。
async function migrateLegacyData({ legacy, basePath, machineDataDirectory, projectRoot, targetDirectory = datasetDirectoryFor(basePath) }) {
  const legacyPaths = pathsFor(machineDataDirectory, legacy.contentDirectory || machineDataDirectory);
  const targetPaths = pathsFor(machineDataDirectory, targetDirectory);
  const prefixes = legacyRootPrefixes(basePath, legacy.fileRoots);
  if (!fs.existsSync(legacyPaths.databasePath)) return { migrated: false, prefixes, converted: 0, unresolvedRootIds: [] };
  fs.mkdirSync(legacyPaths.backupDirectory, { recursive: true, mode: 0o700 });
  const verified = await createVerifiedBackup(legacyPaths.databasePath, legacyPaths.backupDirectory, "before-base-path-migration");
  fs.copyFileSync(verified, targetPaths.databasePath, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(legacyPaths.uploadsDirectory)) fs.cpSync(legacyPaths.uploadsDirectory, targetPaths.uploadsDirectory, { recursive: true, force: false, errorOnExist: false });
  const database = openDatabase(targetPaths.databasePath, projectRoot, targetPaths.backupDirectory);
  try { return { migrated: true, prefixes, ...convertLegacyReferences(database, prefixes) }; }
  finally { database.close(); }
}

// ---- 旧 .TickTockTome/ から .kobito-tools/ への分割移行 ----
// 旧形式は本体とPopNote!が1つのSQLiteを共有していた。メモはPopNote/へ、タグはTags/tags.jsonへ分け、
// 残りを Tomelet/ へ複製する。旧フォルダは消さず .TickTockTome.migrated へ名前を変えて残す。

const POPNOTE_DATABASE_FILE_NAME = "popnote.sqlite3";

function popnoteDatabasePathIn(kobitoDirectory) {
  return path.join(kobitoDirectory, POPNOTE_DIRECTORY_NAME, "database", POPNOTE_DATABASE_FILE_NAME);
}

// 移行中に他のアプリが書き込まないよう、旧 lock.json は本体・PopNote!とも（同じPCでも）有効な間は移行しない。
function legacyLockIsActive(lock, now = Date.now()) {
  if (!lock || typeof lock !== "object" || !(now - Date.parse(lock.heartbeatAt || "") < LOCK_STALE_MS)) return false;
  if (lock.hostname !== os.hostname()) return true;
  return Number.isInteger(lock.pid) && lock.pid !== process.pid && processAlive(lock.pid);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// 旧DBを読み取り専用で開き、整合性を確かめた複製を作る（旧DBは変更しない）。
function copyVerifiedDatabase(source, destination) {
  const database = new DatabaseSync(source, { readOnly: true });
  try { database.exec(`VACUUM INTO ${sqlString(destination)}`); } finally { database.close(); }
  const verification = new DatabaseSync(destination, { readOnly: true });
  try { if (verification.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("移行用の複製の整合性検査に失敗しました。"); }
  finally { verification.close(); }
}

// メモと、その関連（タグ・添付ファイルの登録・貼り付け画像）をPopNote!のDBへ写す。戻り値は写した画像の保存名。
function copyMemosToPopNote(popnote, sourcePath) {
  popnote.exec(`ATTACH DATABASE ${sqlString(sourcePath)} AS source`);
  try {
    return transaction(popnote, () => {
      popnote.exec(`
        INSERT INTO tag_categories(id, name, description, display_order, revision, deleted_at)
          SELECT id, name, description, display_order, revision, deleted_at FROM source.tag_categories WHERE true
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, display_order = excluded.display_order, revision = excluded.revision, deleted_at = excluded.deleted_at;
        INSERT INTO tags(id, category_id, name, description, display_order, revision, archived_at, deleted_at)
          SELECT id, category_id, name, description, display_order, revision, archived_at, deleted_at FROM source.tags;
        INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at, revision, deleted_at)
          SELECT id, title, body_html, body_text, created_at, updated_at, revision, deleted_at FROM source.memos;
        INSERT INTO memo_tags(memo_id, tag_id) SELECT memo_id, tag_id FROM source.memo_tags;
        INSERT INTO managed_files(id, root_id, relative_path, name, extension, created_at, updated_at, revision, deleted_at)
          SELECT id, root_id, relative_path, name, extension, created_at, updated_at, revision, deleted_at FROM source.managed_files
          WHERE id IN (SELECT managed_file_id FROM source.memo_managed_files);
        INSERT INTO memo_managed_files(memo_id, managed_file_id) SELECT memo_id, managed_file_id FROM source.memo_managed_files;
        INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at, deleted_at)
          SELECT id, stored_name, original_name, mime_type, size_bytes, created_at, deleted_at FROM source.managed_uploads
          WHERE id IN (SELECT upload_id FROM source.memo_uploads);
        INSERT INTO memo_uploads(memo_id, upload_id) SELECT memo_id, upload_id FROM source.memo_uploads;
      `);
      return popnote.prepare("SELECT stored_name AS storedName FROM managed_uploads").all().map((row) => row.storedName);
    });
  } finally { popnote.exec("DETACH DATABASE source"); }
}

function tagsFileRecord(database) {
  const categories = database.prepare("SELECT id, name, description, display_order AS displayOrder, revision, deleted_at AS deletedAt FROM tag_categories ORDER BY id").all().map((row) => ({ ...row }));
  const tags = database.prepare("SELECT id, category_id AS categoryId, name, description, display_order AS displayOrder, revision, archived_at AS archivedAt, deleted_at AS deletedAt FROM tags ORDER BY id").all().map((row) => ({ ...row }));
  return { format: TAGS_FORMAT, schemaVersion: 1, revision: 1, updatedAt: new Date().toISOString(), categories, tags };
}

function copyDirectoryIfPresent(source, destination) {
  if (fs.existsSync(source)) fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: false });
}

function migrateLegacyLayout(basePath, { projectRoot }) {
  const legacyDirectory = legacyDatasetDirectoryFor(basePath);
  const legacy = readJsonIfPresent(legacyDatasetFile(basePath));
  if (!legacy) return null;
  if (legacy.format !== LEGACY_DATASET_FORMAT) throw new Error("基準パスの旧Tomeletデータを読み取れません。");
  if (fs.existsSync(datasetFile(basePath))) throw httpError("この基準パスには新旧両方の保存フォルダがあります。.TickTockTome と .kobito-tools の中身を確認してください。", 409);
  const lock = readJsonIfPresent(path.join(legacyDirectory, LOCK_FILE_NAME));
  if (legacyLockIsActive(lock)) throw httpError("旧形式のデータが別の場所（またはPopNote!）で使用中のため、新しい保存形式へ移行できません。閉じてからもう一度お試しください。", 423, { lockHolder: { hostname: String(lock.hostname || "不明なPC").slice(0, 200), heartbeatAt: lock.heartbeatAt || null, samePc: lock.hostname === os.hostname() } });
  const record = datasetRecord(legacy);
  const { stagingDirectory } = stageDatasetDirectory(basePath, record);
  const summary = { datasetId: record.datasetId, memos: 0, tags: 0 };
  try {
    const tomeletDirectory = path.join(stagingDirectory, APP_DATA_DIRECTORY_NAME);
    const legacyPaths = pathsFor(legacyDirectory, legacyDirectory);
    for (const name of ["uploads", "backups", "exports", "quarantine"]) copyDirectoryIfPresent(path.join(legacyDirectory, name), path.join(tomeletDirectory, name));
    if (fs.existsSync(legacyPaths.databasePath)) {
      const tomeletDatabasePath = databasePathIn(tomeletDirectory);
      copyVerifiedDatabase(legacyPaths.databasePath, tomeletDatabasePath);
      const tomelet = openDatabase(tomeletDatabasePath, projectRoot, path.join(tomeletDirectory, "backups"));
      try {
        summary.memos = tomelet.prepare("SELECT count(*) AS count FROM memos").get().count;
        summary.tags = tomelet.prepare("SELECT count(*) AS count FROM tags").get().count;
        if (summary.memos) {
          const popnoteDatabasePath = popnoteDatabasePathIn(stagingDirectory);
          for (const name of ["database", "uploads"]) fs.mkdirSync(path.join(stagingDirectory, POPNOTE_DIRECTORY_NAME, name), { recursive: true, mode: 0o700 });
          const popnote = openDatabase(popnoteDatabasePath, projectRoot);
          let storedNames;
          try { storedNames = copyMemosToPopNote(popnote, tomeletDatabasePath); if (popnote.prepare("PRAGMA foreign_key_check").all().length) throw new Error("メモの移行で参照の整合性が取れませんでした。"); }
          finally { popnote.close(); }
          for (const storedName of storedNames) {
            const source = path.join(legacyDirectory, "uploads", storedName);
            if (!storedName.includes("/") && fs.existsSync(source)) fs.copyFileSync(source, path.join(stagingDirectory, POPNOTE_DIRECTORY_NAME, "uploads", storedName), fs.constants.COPYFILE_EXCL);
          }
          // 本体側のメモは消す（以後はPopNote!のDBが正本。表示する場合は読み取って写す）。
          transaction(tomelet, () => tomelet.exec("DELETE FROM memos"));
        }
        fs.mkdirSync(path.join(stagingDirectory, TAGS_DIRECTORY_NAME), { recursive: true, mode: 0o700 });
        writeJsonAtomic(path.join(stagingDirectory, TAGS_DIRECTORY_NAME, "tags.json"), tagsFileRecord(tomelet));
      } finally { tomelet.close(); }
    }
    if (fs.existsSync(datasetFile(basePath))) throw httpError("この基準パスには既にTomeletのデータがあります。", 409);
    fs.renameSync(stagingDirectory, kobitoDirectoryFor(basePath));
  } catch (error) {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
  let archived = `${legacyDirectory}.migrated`;
  if (fs.existsSync(archived)) archived = `${legacyDirectory}.migrated-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.renameSync(legacyDirectory, archived);
  return { ...summary, archivedDirectory: archived };
}

// ---- 基準パス外を指したままの参照（要再リンク） ----

function unresolvedReferences(database, limit = 300) {
  return database.prepare(`
    SELECT 'library' AS kind, id, title AS name, source_root_id AS rootId, source_relative_path AS relativePath FROM library_items WHERE source_root_id IS NOT NULL AND source_root_id <> ? AND deleted_at IS NULL
    UNION ALL
    SELECT 'managed', id, name, root_id, relative_path FROM managed_files WHERE root_id <> ? AND deleted_at IS NULL
    UNION ALL
    SELECT 'journal-file', fl.id, CASE WHEN fl.display_name <> '' THEN fl.display_name ELSE fl.relative_path END, fl.root_id, fl.relative_path FROM file_links fl JOIN journal_entries j ON j.id = fl.journal_id WHERE fl.root_id <> ? AND j.deleted_at IS NULL
    ORDER BY 1, 3 LIMIT ?`).all(BASE_ROOT_ID, BASE_ROOT_ID, BASE_ROOT_ID, limit);
}

function relinkReference(database, kind, id, relativePath) {
  const table = { library: ["library_items", "source_root_id", "source_relative_path"], managed: ["managed_files", "root_id", "relative_path"], "journal-file": ["file_links", "root_id", "relative_path"] }[kind];
  if (!table) throw new Error("再リンクの種類が正しくありません。");
  const [name, rootColumn, pathColumn] = table;
  return transaction(database, () => {
    const result = database.prepare(`UPDATE ${name} SET ${rootColumn} = ?, ${pathColumn} = ? WHERE id = ? AND ${rootColumn} <> ?`).run(BASE_ROOT_ID, relativePath, id, BASE_ROOT_ID);
    if (!Number(result.changes)) throw httpError("再リンクする項目が見つかりません。", 404);
    return { ok: true };
  });
}

module.exports = {
  BASE_ROOT_ID, DATASET_FILE_NAME, LOCK_HEARTBEAT_MS, LOCK_STALE_MS,
  acquireLock, applyFolderIcon, convertLegacyReferences, createDataset, createDatasetWith, datasetPaths, ensureDatasetDirectories,
  joinRelative, legacyRootPrefixes, lockIsActive, migrateLegacyData, migrateLegacyLayout, normalizeBasePath, popnoteDatabasePathIn, readDataset, readLock,
  relinkReference, releaseLock, startLockHeartbeat, unresolvedReferences, validateDatasetId, writeDataset,
};
