"use strict";

// PopNote!のメモ（.kobito-tools/PopNote/database/popnote.sqlite3）を、本体のカレンダー・検索・ファイル画面に表示するための写し。
// 正本はPopNote!のDBで、本体は読み取り専用で開いて、自分のDBの memos 表へ丸ごと写し直す（本体からメモは編集しない）。
// 表示しない設定のときは、写しを空にする。
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { transaction } = require("./database/connection.js");
const { popnoteDirectoryFor } = require("./settings.js");

function popnoteDatabasePath(basePath) {
  return path.join(popnoteDirectoryFor(basePath), "database", "popnote.sqlite3");
}

function popnoteUploadsDirectory(basePath) {
  return path.join(popnoteDirectoryFor(basePath), "uploads");
}

function popnoteDetected(basePath) {
  return Boolean(basePath) && fs.existsSync(popnoteDatabasePath(basePath));
}

// PopNote!のDBが前回写したときから変わったかを、更新日時と大きさで安く確かめる。
function popnoteStamp(basePath) {
  try { const info = fs.statSync(popnoteDatabasePath(basePath)); return `${info.mtimeMs}:${info.size}`; } catch { return "missing"; }
}

function readPopNote(basePath) {
  const source = new DatabaseSync(popnoteDatabasePath(basePath), { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout = 5000");
    // PopNote!が書き込み中でも、読み取りの間は同じ時点の内容を見る。
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

// 本体のDBのメモを、PopNote!のDBの内容で置き換える。タグは先に共有タグを同期しておくこと（無いタグの関連は写さない）。
function mirrorPopNoteMemos(database, basePath) {
  const data = readPopNote(basePath);
  return transaction(database, () => {
    database.exec("DELETE FROM memos");
    const insertMemo = database.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const memo of data.memos) insertMemo.run(memo.id, memo.title, memo.bodyHtml, memo.bodyText, memo.createdAt, memo.updatedAt, memo.revision);
    const insertTag = database.prepare("INSERT OR IGNORE INTO memo_tags(memo_id, tag_id) SELECT ?, id FROM tags WHERE id = ?");
    for (const row of data.tags) insertTag.run(row.memoId, row.tagId);
    // 同じファイルを本体でも登録済みなら、その登録（ID）に関連付ける。
    const findFile = database.prepare("SELECT id FROM managed_files WHERE root_id = ? AND relative_path = ?");
    const insertFile = database.prepare("INSERT OR IGNORE INTO managed_files(id, root_id, relative_path, name, extension, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const linkFile = database.prepare("INSERT OR IGNORE INTO memo_managed_files(memo_id, managed_file_id) VALUES (?, ?)");
    for (const file of data.files) {
      let id = findFile.get(file.rootId, file.relativePath)?.id;
      if (!id) { insertFile.run(file.id, file.rootId, file.relativePath, file.name, file.extension, file.createdAt, file.updatedAt); id = findFile.get(file.rootId, file.relativePath)?.id; }
      if (id) linkFile.run(file.memoId, id);
    }
    // 画像の実体はPopNote/uploads/に置いたまま。配信時に本体のuploads/に無ければPopNote側を探す。
    const insertUpload = database.prepare("INSERT OR IGNORE INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    const linkUpload = database.prepare("INSERT OR IGNORE INTO memo_uploads(memo_id, upload_id) SELECT ?, id FROM managed_uploads WHERE id = ?");
    for (const upload of data.uploads) { insertUpload.run(upload.id, upload.storedName, upload.originalName, upload.mimeType, upload.sizeBytes, upload.createdAt); linkUpload.run(upload.memoId, upload.id); }
    return data.memos.length;
  });
}

function clearMemoMirror(database) {
  transaction(database, () => database.exec("DELETE FROM memos"));
}

module.exports = { clearMemoMirror, mirrorPopNoteMemos, popnoteDatabasePath, popnoteDetected, popnoteStamp, popnoteUploadsDirectory };
