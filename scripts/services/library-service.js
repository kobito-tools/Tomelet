"use strict";

const itemTypes = new Set(["book", "paper"]);
const statuses = new Set(["unverified", "unread", "reading", "read", "cited"]);

function validateLibraryItem(input, editing = false) {
  if (!input || !itemTypes.has(input.itemType)) throw new Error("資料種別が正しくありません。");
  const title = String(input.title || "").trim();
  if (!title || title.length > 500) throw new Error("題名を入力してください。");
  const authors = [...new Set((Array.isArray(input.authors) ? input.authors : []).map((value) => String(value).trim()).filter(Boolean))];
  if (!authors.length || authors.some((value) => value.length > 300)) throw new Error("著者・編者を入力してください。");
  const year = input.year === "" || input.year == null ? null : Number(input.year);
  if (year != null && (!Number.isInteger(year) || year < 1000 || year > 2200)) throw new Error("出版年を確認してください。");
  const status = statuses.has(input.status) ? input.status : "unread";
  const priority = Number(input.priority ?? 3);
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) throw new Error("優先度は1〜5にしてください。");
  const url = String(input.url || "").trim();
  if (url && !/^https:\/\//i.test(url)) throw new Error("URLはHTTPSだけを登録できます。");
  const keywords = [...new Set((Array.isArray(input.keywords) ? input.keywords : []).map((value) => String(value).trim()).filter(Boolean))];
  if (keywords.some((value) => value.length > 200)) throw new Error("キーワードが長すぎます。");
  const doi = String(input.doi || "").trim();
  if (doi && !/^10\.\d{4,9}\/\S+$/i.test(doi)) throw new Error("DOIは「10.xxxx/…」の形式で入力してください。");
  const bibtexCode = String(input.bibtexCode || "").trim();
  if (bibtexCode.length > 100_000) throw new Error("BibTeXコードが長すぎます。");
  const coverUploadId = String(input.coverUploadId || "");
  if (coverUploadId && !/^[A-Za-z0-9_-]+$/.test(coverUploadId)) throw new Error("表紙画像の指定が正しくありません。");
  const sourceRootId = String(input.sourceRootId || ""), sourceRelativePath = String(input.sourceRelativePath || "");
  if (sourceRootId || sourceRelativePath) {
    const { safeRelativePath } = require("./journal-service.js");
    if (!/^[A-Za-z0-9_-]+$/.test(sourceRootId) || !safeRelativePath(sourceRelativePath) || !/\.pdf$/i.test(sourceRelativePath)) throw new Error("PDFの基準パスと相対パスを確認してください。");
  }
  const result = { sourceRootId, sourceRelativePath, itemType: input.itemType, title, authors, year, publication: String(input.publication || "").trim().slice(0, 500), status, priority, favorite: Boolean(input.favorite), keywords: input.itemType === "paper" ? keywords : [], doi: input.itemType === "paper" ? doi.slice(0, 500) : "", bibtexCode: input.itemType === "paper" ? bibtexCode : "", takeawayMarkdown: String(input.takeawayMarkdown || "").slice(0, 500_000), url: url.slice(0, 2000), tagIds: [...new Set(Array.isArray(input.tagIds) ? input.tagIds : [])], journalIds: [...new Set(Array.isArray(input.journalIds) ? input.journalIds : [])], coverUploadId };
  if (editing) {
    const revision = Number(input.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("更新情報が正しくありません。再読み込みしてください。");
    result.revision = revision;
  }
  return result;
}

module.exports = { validateLibraryItem };
