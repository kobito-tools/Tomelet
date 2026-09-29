"use strict";

// 連携アプリのメモを、本体のカレンダー・検索・ファイル画面に表示するための写し。
//   PopNote!     .kobito-tools/PopNote/database/popnote.sqlite3        クイックメモ
//   Pastephant   .kobito-tools/Pastephant/database/pastephant.sqlite3  クリップボード履歴から残した日ごとのメモ
// 正本は各アプリのDB（本体と同じ表の形）で、本体は読み取り専用で開いて、自分のDBの memos 表へ丸ごと写し直す（本体からメモは編集しない）。
// 表示しない設定のときは、写しから外す。
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { transaction } = require("./database/connection.js");
const { pastephantDirectoryFor, popnoteDirectoryFor } = require("./settings.js");

const COMPANIONS = {
  popnote: { directory: popnoteDirectoryFor, file: "popnote.sqlite3" },
  pastephant: { directory: pastephantDirectoryFor, file: "pastephant.sqlite3" },
};

// 写したメモがどのアプリのものか（開くときに、どのアプリへ渡すかを決める）。
const memoSources = new Map();

function companionDatabasePath(basePath, app) {
  return path.join(COMPANIONS[app].directory(basePath), "database", COMPANIONS[app].file);
}

function companionUploadsDirectory(basePath, app) {
  return path.join(COMPANIONS[app].directory(basePath), "uploads");
}

function companionDetected(basePath, app) {
  return Boolean(basePath) && fs.existsSync(companionDatabasePath(basePath, app));
}

// DBが前回写したときから変わったかを、更新日時と大きさで安く確かめる。
function companionStamp(basePath, app) {
  try { const info = fs.statSync(companionDatabasePath(basePath, app)); return `${info.mtimeMs}:${info.size}`; } catch { return "missing"; }
}

function readCompanion(databasePath) {
  const source = new DatabaseSync(databasePath, { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    // 連携アプリが書き込み中でも、読み取りの間は同じ時点の内容を見る。
    source.exec("BEGIN");
    try {
      const memos = source.prepare("SELECT id, title, body_html AS bodyHtml, body_text AS bodyText, created_at AS createdAt, updated_at AS updatedAt, revision FROM memos WHERE deleted_at IS NULL").all();
      const tags = source.prepare("SELECT r.memo_id AS memoId, r.tag_id AS tagId FROM memo_tags r JOIN memos m ON m.id = r.memo_id WHERE m.deleted_at IS NULL").all();
      const files = source.prepare("SELECT r.memo_id AS memoId, f.id, f.root_id AS rootId, f.relative_path AS relativePath, f.name, f.extension, f.created_at AS createdAt, f.updated_at AS updatedAt FROM memo_managed_files r JOIN memos m ON m.id = r.memo_id JOIN managed_files f ON f.id = r.managed_file_id WHERE m.deleted_at IS NULL AND f.deleted_at IS NULL").all();
      const uploads = source.prepare("SELECT r.memo_id AS memoId, u.id, u.stored_name AS storedName, u.original_name AS originalName, u.mime_type AS mimeType, u.size_bytes AS sizeBytes, u.created_at AS createdAt FROM memo_uploads r JOIN memos m ON m.id = r.memo_id JOIN managed_uploads u ON u.id = r.upload_id WHERE m.deleted_at IS NULL AND u.deleted_at IS NULL").all();
      return { memos, tags, files, uploads };
    } finally { source.exec("COMMIT"); }
  } finally { source.close(); }
}

// 本体のDBのメモを、指定した連携アプリのDBの内容で置き換える。タグは先に共有タグを同期しておくこと（無いタグの関連は写さない）。
function mirrorCompanionMemos(database, basePath, apps) {
  const sources = apps.filter((app) => companionDetected(basePath, app)).map((app) => ({ app, data: readCompanion(companionDatabasePath(basePath, app)) }));
  return transaction(database, () => {
    database.exec("DELETE FROM memos");
    memoSources.clear();
    const insertMemo = database.prepare("INSERT OR IGNORE INTO memos(id, title, body_html, body_text, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insertTag = database.prepare("INSERT OR IGNORE INTO memo_tags(memo_id, tag_id) SELECT ?, id FROM tags WHERE id = ?");
    // 同じファイルを本体でも登録済みなら、その登録（ID）に関連付ける。
    const findFile = database.prepare("SELECT id FROM managed_files WHERE root_id = ? AND relative_path = ?");
    const insertFile = database.prepare("INSERT OR IGNORE INTO managed_files(id, root_id, relative_path, name, extension, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const linkFile = database.prepare("INSERT OR IGNORE INTO memo_managed_files(memo_id, managed_file_id) VALUES (?, ?)");
    // 画像の実体は各アプリの uploads/ に置いたまま。配信時に本体の uploads/ に無ければ各アプリの側を探す。
    const insertUpload = database.prepare("INSERT OR IGNORE INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    const linkUpload = database.prepare("INSERT OR IGNORE INTO memo_uploads(memo_id, upload_id) SELECT ?, id FROM managed_uploads WHERE id = ?");
    let count = 0;
    for (const { app, data } of sources) {
      for (const memo of data.memos) {
        if (memoSources.has(memo.id)) continue;
        insertMemo.run(memo.id, memo.title, memo.bodyHtml, memo.bodyText, memo.createdAt, memo.updatedAt, memo.revision);
        memoSources.set(memo.id, app);
        count += 1;
      }
      const owned = (memoId) => memoSources.get(memoId) === app;
      for (const row of data.tags) if (owned(row.memoId)) insertTag.run(row.memoId, row.tagId);
      for (const file of data.files) {
        if (!owned(file.memoId)) continue;
        let id = findFile.get(file.rootId, file.relativePath)?.id;
        if (!id) { insertFile.run(file.id, file.rootId, file.relativePath, file.name, file.extension, file.createdAt, file.updatedAt); id = findFile.get(file.rootId, file.relativePath)?.id; }
        if (id) linkFile.run(file.memoId, id);
      }
      for (const upload of data.uploads) {
        if (!owned(upload.memoId)) continue;
        insertUpload.run(upload.id, upload.storedName, upload.originalName, upload.mimeType, upload.sizeBytes, upload.createdAt);
        linkUpload.run(upload.memoId, upload.id);
      }
    }
    return count;
  });
}

function clearMemoMirror(database) {
  transaction(database, () => database.exec("DELETE FROM memos"));
  memoSources.clear();
}

// 写したメモを作ったアプリ（見つからなければ PopNote!）。
function memoSource(memoId) {
  return memoSources.get(memoId) || "popnote";
}

// 本体の uploads/ に無い画像を、連携アプリの uploads/ から探す。
function companionUploadPath(basePath, storedName) {
  if (!basePath || path.basename(storedName) !== storedName) return null;
  for (const app of Object.keys(COMPANIONS)) {
    const candidate = path.join(companionUploadsDirectory(basePath, app), storedName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// 以前からの呼び方（PopNote!だけ）。
const popnoteDatabasePath = (basePath) => companionDatabasePath(basePath, "popnote");
const popnoteUploadsDirectory = (basePath) => companionUploadsDirectory(basePath, "popnote");
const popnoteDetected = (basePath) => companionDetected(basePath, "popnote");
const popnoteStamp = (basePath) => companionStamp(basePath, "popnote");
const mirrorPopNoteMemos = (database, basePath) => mirrorCompanionMemos(database, basePath, ["popnote"]);
const pastephantDatabasePath = (basePath) => companionDatabasePath(basePath, "pastephant");

module.exports = {
  clearMemoMirror, companionDatabasePath, companionDetected, companionStamp, companionUploadPath, companionUploadsDirectory, memoSource, mirrorCompanionMemos,
  mirrorPopNoteMemos, pastephantDatabasePath, popnoteDatabasePath, popnoteDetected, popnoteStamp, popnoteUploadsDirectory,
};
