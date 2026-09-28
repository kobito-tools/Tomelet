"use strict";

// 両アプリ（Tomelet・PopNote!）で共有するタグ。正本は .kobito-tools/Tags/tags.json に置き、
// 各アプリのDBの tags / tag_categories はその写しとして持つ（日記・メモなどとの関連付けに外部キーを使うため）。
// - 同じIDは revision の大きい方を採用する。同じ revision なら内容を比べて決まった方を採る（どちらのアプリでも同じ結果になる）。
// - タグは完全削除せず、アーカイブだけにする。片方のDBに参照先のない関連が残らないようにするため。
// - 書き込みは一時ファイルからの置き換えで行い、書く直前に他のアプリが更新していないか確かめる。
// PopNote! の Sources/TagStore.swift も同じ規則で同期する。
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { transaction } = require("./database/connection.js");
const { tagsFileFor, writeJsonAtomic } = require("./settings.js");

const TAGS_FORMAT = "kobito-tags";
const MAX_ATTEMPTS = 5;

function readTagsFile(filePath) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return { revision: 0, categories: [], tags: [] };
    throw new Error("共有タグ（tags.json）を読み取れません。");
  }
  if (raw?.format !== TAGS_FORMAT) throw new Error("共有タグ（tags.json）の形式が正しくありません。");
  return { revision: Number.isSafeInteger(raw.revision) ? raw.revision : 0, categories: Array.isArray(raw.categories) ? raw.categories.filter(validRecord) : [], tags: Array.isArray(raw.tags) ? raw.tags.filter(validRecord) : [] };
}

function validRecord(record) {
  return record && typeof record.id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(record.id) && typeof record.name === "string" && record.name.trim();
}

function text(value, limit) { return typeof value === "string" ? value.slice(0, limit) : ""; }
function nullableText(value) { return typeof value === "string" && value ? value.slice(0, 50) : null; }
function positive(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 1 ? number : 1; }

function normalizeCategory(record) {
  return { id: record.id, name: text(record.name, 200).trim(), description: text(record.description, 1000), displayOrder: positive(record.displayOrder), revision: positive(record.revision), deletedAt: nullableText(record.deletedAt) };
}

function normalizeTag(record) {
  return { id: record.id, categoryId: typeof record.categoryId === "string" && record.categoryId ? record.categoryId : null, name: text(record.name, 200).trim(), description: text(record.description, 1000), displayOrder: positive(record.displayOrder), revision: positive(record.revision), archivedAt: nullableText(record.archivedAt), deletedAt: nullableText(record.deletedAt) };
}

// 同じ内容かを比べ、同じrevisionのときの勝ち負けを決めるための文字列。項目はnormalize〜で決まった順に並ぶ。
// PopNote!（TagStore.swift）も同じ文字列を作り、UTF-16の並びで比べる。
function canonical(record) {
  return Object.values(record).map((value) => (value === null ? "\u0000" : String(value))).join("\u001f");
}

function byId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.revision !== b.revision) return a.revision > b.revision ? a : b;
  return canonical(a) >= canonical(b) ? a : b;
}

function mergeById(...lists) {
  const merged = new Map();
  for (const list of lists) for (const record of list) merged.set(record.id, newer(merged.get(record.id), record));
  return [...merged.values()].sort(byId);
}

// 名前はDBで一意。別々に同名を作った場合は、IDの順で後になる方の名前に印を付け、revisionを上げて全体へ広める。
function resolveNameCollisions(records) {
  const used = new Set();
  return records.map((record) => {
    if (!used.has(record.name)) { used.add(record.name); return record; }
    let name = `${record.name} (${record.id.slice(-4)})`, suffix = 2;
    while (used.has(name)) name = `${record.name} (${record.id.slice(-4)}-${suffix++})`;
    used.add(name);
    return { ...record, name, revision: record.revision + 1 };
  });
}

function databaseCategories(database) {
  return database.prepare("SELECT id, name, description, display_order AS displayOrder, revision, deleted_at AS deletedAt FROM tag_categories").all().map((row) => normalizeCategory({ ...row }));
}

function databaseTags(database) {
  return database.prepare("SELECT id, category_id AS categoryId, name, description, display_order AS displayOrder, revision, archived_at AS archivedAt, deleted_at AS deletedAt FROM tags").all().map((row) => normalizeTag({ ...row }));
}

function sameList(a, b) {
  return a.length === b.length && a.every((record, index) => canonical(record) === canonical(b[index]));
}

// 統合結果をDBへ反映する。名前の入れ替え（AとBの名前を交換など）でも一意制約に触れないよう、先に仮の名前へ退避する。
function applyToDatabase(database, table, records, current, columns) {
  const currentById = new Map(current.map((record) => [record.id, record]));
  const changed = records.filter((record) => !currentById.has(record.id) || canonical(currentById.get(record.id)) !== canonical(record));
  if (!changed.length) return 0;
  const park = database.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`);
  for (const record of changed) if (currentById.has(record.id)) park.run(`\u0000${randomUUID()}`, record.id);
  const names = columns.map(([, column]) => column);
  const upsert = database.prepare(`INSERT INTO ${table}(${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${names.filter((name) => name !== "id").map((name) => `${name} = excluded.${name}`).join(", ")}`);
  for (const record of changed) upsert.run(...columns.map(([key]) => record[key]));
  return changed.length;
}

const categoryColumns = [["id", "id"], ["name", "name"], ["description", "description"], ["displayOrder", "display_order"], ["revision", "revision"], ["deletedAt", "deleted_at"]];
const tagColumns = [["id", "id"], ["categoryId", "category_id"], ["name", "name"], ["description", "description"], ["displayOrder", "display_order"], ["revision", "revision"], ["archivedAt", "archived_at"], ["deletedAt", "deleted_at"]];

// tags.json とDBの写しを双方向に統合する。戻り値は { changedDatabase, changedFile }。
function syncTags(database, basePath) {
  const filePath = tagsFileFor(basePath);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const file = readTagsFile(filePath);
    const localCategories = databaseCategories(database), localTags = databaseTags(database);
    const categories = resolveNameCollisions(mergeById(localCategories, file.categories.map(normalizeCategory)));
    const categoryIds = new Set(categories.map((category) => category.id));
    // 分類が見つからないタグ（古い版が作ったものなど）は「その他」へ入れる。
    const tags = resolveNameCollisions(mergeById(localTags, file.tags.map(normalizeTag)).map((tag) => (tag.categoryId && !categoryIds.has(tag.categoryId) ? { ...tag, categoryId: categoryIds.has("other") ? "other" : null } : tag)));
    const changedDatabase = transaction(database, () => applyToDatabase(database, "tag_categories", categories, localCategories, categoryColumns) + applyToDatabase(database, "tags", tags, localTags, tagColumns)) > 0;
    const fileCategories = file.categories.map(normalizeCategory).sort(byId);
    const fileTags = file.tags.map(normalizeTag).sort(byId);
    if (sameList(categories, fileCategories) && sameList(tags, fileTags)) return { changedDatabase, changedFile: false };
    // 読んでから書くまでの間に他のアプリが書き換えていたら、読み直して統合し直す。
    if (readTagsFile(filePath).revision !== file.revision) continue;
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    writeJsonAtomic(filePath, { format: TAGS_FORMAT, schemaVersion: 1, revision: file.revision + 1, updatedAt: new Date().toISOString(), categories, tags });
    return { changedDatabase, changedFile: true };
  }
  throw Object.assign(new Error("共有タグが他のアプリで更新中です。少し待ってからもう一度お試しください。"), { statusCode: 409 });
}

// tags.json が前回の同期から変わったかを、更新日時と大きさで安く確かめる。
function tagsFileStamp(basePath) {
  try { const info = fs.statSync(tagsFileFor(basePath)); return `${info.mtimeMs}:${info.size}`; } catch { return "missing"; }
}

module.exports = { TAGS_FORMAT, readTagsFile, syncTags, tagsFileStamp };
