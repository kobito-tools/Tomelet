"use strict";

// 基準パスを「データセット」として扱う。基準パス直下の .TickTockTome/ に
// ID・共有設定・SQLite・アップロード・バックアップを置き、ファイルは基準パスからの相対パスだけで参照する。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { openDatabase, transaction } = require("./database/connection.js");
const { createVerifiedBackup } = require("./database/backup.js");
const { DATASET_DIRECTORY_NAME, datasetDirectoryFor, normalizeSharedSettings, pathsFor, readJsonIfPresent, writeJsonAtomic } = require("./settings.js");

const DATASET_FORMAT = "ticktocktome-dataset";
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

// .TickTockTome 自体を選んだ場合は、その親フォルダを基準パスとして扱う。
function normalizeBasePath(selected) {
  const resolved = path.resolve(selected);
  return path.basename(resolved) === DATASET_DIRECTORY_NAME ? path.dirname(resolved) : resolved;
}

function datasetFile(basePath) {
  return path.join(datasetDirectoryFor(basePath), DATASET_FILE_NAME);
}

function normalizeLegacyRoots(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter(([id, prefix]) => /^[A-Za-z0-9_-]{1,80}$/.test(id) && (prefix === null || typeof prefix === "string")));
}

function readDataset(basePath) {
  const raw = readJsonIfPresent(datasetFile(basePath));
  if (!raw) return null;
  if (raw.format !== DATASET_FORMAT) throw new Error("基準パスのTomeletデータを読み取れません。");
  return {
    datasetId: validateDatasetId(raw.datasetId),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    revision: Number.isSafeInteger(raw.revision) && raw.revision >= 1 ? raw.revision : 1,
    settings: normalizeSharedSettings(raw.settings || {}),
    legacyRoots: normalizeLegacyRoots(raw.legacyRoots),
  };
}

function writeDataset(basePath, dataset) {
  writeJsonAtomic(datasetFile(basePath), { format: DATASET_FORMAT, schemaVersion: 1, datasetId: dataset.datasetId, createdAt: dataset.createdAt, revision: dataset.revision, settings: normalizeSharedSettings(dataset.settings), legacyRoots: dataset.legacyRoots || {} });
}

function datasetPaths(machineDataDirectory, basePath) {
  return pathsFor(machineDataDirectory, datasetDirectoryFor(basePath));
}

function ensureDatasetDirectories(basePath) {
  const directory = datasetDirectoryFor(basePath);
  for (const name of DATASET_SUBDIRECTORIES) fs.mkdirSync(path.join(directory, name), { recursive: true, mode: 0o700 });
}

// 作成は一時フォルダで行い、最後に名前を変えて完成させる。途中で失敗しても中途半端な.TickTockTomeを残さない。
function stageDataset(basePath, { datasetId, settings = {}, legacyRoots = {} }) {
  const id = validateDatasetId(datasetId);
  if (!fs.statSync(basePath).isDirectory()) throw new Error("基準パスはフォルダを指定してください。");
  if (fs.existsSync(datasetDirectoryFor(basePath))) throw httpError("この基準パスには既にTomeletのデータがあります。", 409);
  const stagingDirectory = path.join(basePath, `${DATASET_DIRECTORY_NAME}-creating-${randomUUID()}`);
  for (const name of DATASET_SUBDIRECTORIES) fs.mkdirSync(path.join(stagingDirectory, name), { recursive: true, mode: 0o700 });
  const dataset = { datasetId: id, createdAt: new Date().toISOString(), revision: 1, settings: normalizeSharedSettings(settings), legacyRoots: normalizeLegacyRoots(legacyRoots) };
  fs.writeFileSync(path.join(stagingDirectory, DATASET_FILE_NAME), `${JSON.stringify({ format: DATASET_FORMAT, schemaVersion: 1, ...dataset }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { stagingDirectory, dataset };
}

function commitStagedDataset(basePath, stagingDirectory) {
  // 同時に別の場所から作成された場合は上書きしない（renameは既存の空でないフォルダを置き換えない）。
  if (fs.existsSync(datasetDirectoryFor(basePath))) throw httpError("この基準パスには既にTomeletのデータがあります。", 409);
  fs.renameSync(stagingDirectory, datasetDirectoryFor(basePath));
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
    const result = await populate(stagingDirectory);
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

function lockIsActive(lock, machineId, now = Date.now()) {
  if (!lock || typeof lock !== "object") return false;
  // 同じPCのPopNote!が単独で開いているデータは、本体が開くときに引き継ぐ。
  // PopNote!はロックを失ったことを検知し、以後は本体の連携API経由で保存する。
  if (lock.app === "popnote" && lock.hostname === os.hostname()) return false;
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
  joinRelative, legacyRootPrefixes, lockIsActive, migrateLegacyData, normalizeBasePath, readDataset, readLock,
  relinkReference, releaseLock, startLockHeartbeat, unresolvedReferences, validateDatasetId, writeDataset,
};
