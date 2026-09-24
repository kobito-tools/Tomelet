"use strict";

const path = require("node:path");

function requiredString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を入力してください。`);
  if (value.length > maxLength) throw new Error(`${label}が長すぎます。`);
  return value.trim();
}

function safeRelativePath(value) {
  if (typeof value !== "string" || !value.trim() || path.isAbsolute(value) || /^(?:[A-Za-z]:[\\/]|[\\/]{2})/.test(value) || value.includes("\0") || value.split(/[\\/]/).includes("..")) return false;
  return true;
}

class JournalService {
  constructor(repository, settings) { this.repository = repository; this.settings = settings; }

  validate(input, editing = false) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("日記データの形式が正しくありません。");
    const entryDate = requiredString(input.entryDate, "日付", 10);
    const parsedDate = new Date(`${entryDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== entryDate) throw new Error("日付は実在するYYYY-MM-DD形式にしてください。");
    const title = requiredString(input.title, "題名", 300);
    const bodyMarkdown = typeof input.bodyMarkdown === "string" ? input.bodyMarkdown : "";
    if (bodyMarkdown.length > 2_000_000) throw new Error("日記本文が長すぎます。");
    const tagIds = [...new Set(Array.isArray(input.tagIds) ? input.tagIds : [])];
    const projectIds = [...new Set(Array.isArray(input.projectIds) ? input.projectIds : [])];
    const rootIds = new Set(this.settings.fileRoots.map((root) => root.id));
    const files = (Array.isArray(input.files) ? input.files : []).map((file) => {
      if (!file || !rootIds.has(file.rootId)) throw new Error("登録されていない基準フォルダが指定されています。");
      if (!safeRelativePath(file.relativePath)) throw new Error("関連ファイルの相対パスが正しくありません。");
      const targetType = file.targetType === "folder" ? "folder" : "file";
      const id = typeof file.id === "string" ? file.id : "";
      if (id && !/^[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error("関連ファイルの内部IDが正しくありません。");
      return { id, rootId: file.rootId, relativePath: file.relativePath.replace(/\\/g, "/"), targetType, displayName: String(file.displayName || "").slice(0, 300), note: String(file.note || "").slice(0, 2000) };
    });
    const result = { entryDate, title, bodyMarkdown, tagIds, projectIds, files };
    if (editing) {
      const revision = Number(input.revision);
      if (!Number.isInteger(revision) || revision < 1) throw new Error("更新情報が正しくありません。再読み込みしてください。");
      result.revision = revision;
    }
    return result;
  }
}

module.exports = { JournalService, safeRelativePath };
