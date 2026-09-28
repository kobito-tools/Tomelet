"use strict";

const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { openDatabase, transaction } = require("../scripts/database/connection.js");
const { activePaths, ensurePrivateDirectories } = require("../scripts/settings.js");
const { safeRelativePath } = require("../scripts/services/journal-service.js");

const projectRoot = path.resolve(__dirname, "..");

function readSource(directory, name) {
  const filePath = path.join(directory, name);
  const info = fs.statSync(filePath);
  if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new Error(`${name}が通常ファイルでないか、50MBを超えています。`);
  const text = fs.readFileSync(filePath, "utf8");
  return { text, value: JSON.parse(text) };
}

function sourceData(sourceDirectory) {
  const directory = fs.realpathSync(sourceDirectory);
  const logs = readSource(directory, "research-log.json");
  const papers = readSource(directory, "papers.json");
  const registry = readSource(directory, "tags.json");
  if (!Array.isArray(logs.value) || !Array.isArray(papers.value) || !Array.isArray(registry.value?.categories) || !Array.isArray(registry.value?.tags)) throw new Error("ResearchNoteデータの全体形式が正しくありません。");
  const contentHash = createHash("sha256").update(logs.text).update("\0").update(papers.text).update("\0").update(registry.text).digest("hex");
  const pathHash = createHash("sha256").update(directory).digest("hex");
  return { directory, logs, papers, registry, contentHash, pathHash };
}

function importResearchNote({ sourceDirectory, databasePath, rootId = "" }) {
  const source = sourceData(sourceDirectory);
  const database = openDatabase(databasePath, projectRoot);
  const existing = database.prepare("SELECT result_json AS resultJson FROM import_runs WHERE source_content_hash = ? AND completed_at IS NOT NULL").get(source.contentHash);
  if (existing) { database.close(); return { ...JSON.parse(existing.resultJson), skipped: true }; }
  const runId = `import-${randomUUID()}`;
  const startedAt = new Date().toISOString();
  try {
    const result = transaction(database, () => {
      database.prepare("INSERT INTO import_runs(id, source_type, source_path_hash, source_content_hash, started_at) VALUES (?, 'researchnote-json', ?, ?, ?)").run(runId, source.pathHash, source.contentHash, startedAt);
      const archive = database.prepare("INSERT INTO legacy_import_records(import_run_id, source_file, source_id, record_type, raw_json) VALUES (?, ?, ?, ?, ?)");
      for (const record of source.logs.value) archive.run(runId, "research-log.json", String(record.id || randomUUID()), "activity", JSON.stringify(record));
      for (const record of source.papers.value) archive.run(runId, "papers.json", String(record.id || randomUUID()), "paper", JSON.stringify(record));
      for (const record of source.registry.value.categories) archive.run(runId, "tags.json", `category:${record.id}`, "tag-category", JSON.stringify(record));
      for (const record of source.registry.value.tags) archive.run(runId, "tags.json", `tag:${record.id}`, "tag", JSON.stringify(record));
      for (const record of source.registry.value.activityTypes || []) archive.run(runId, "tags.json", `activity-type:${record.id}`, "activity-type", JSON.stringify(record));

      const categoryMap = new Map();
      const addCategory = database.prepare("INSERT INTO tag_categories(id, name, description, display_order) VALUES (?, ?, ?, ?)");
      for (const [index, category] of source.registry.value.categories.entries()) {
        const id = `rn-category-${category.id}`;
        categoryMap.set(category.id, id);
        addCategory.run(id, `ResearchNote / ${category.label}`, String(category.description || ""), Number(category.order) || index + 1);
      }
      const kindCategoryId = "rn-category-activity-type";
      addCategory.run(kindCategoryId, "ResearchNote / 活動種別", "ResearchNoteから移行した活動種別", source.registry.value.categories.length + 1);

      const tagMap = new Map();
      const addTag = database.prepare("INSERT INTO tags(id, category_id, name, description, display_order) VALUES (?, ?, ?, ?, ?)");
      for (const [index, tag] of source.registry.value.tags.entries()) {
        const id = `rn-tag-${tag.id}`;
        tagMap.set(tag.id, id);
        addTag.run(id, categoryMap.get(tag.category) || "other", `ResearchNote / ${tag.name}`, String(tag.description || ""), Number(tag.order) || index + 1);
      }
      const kindMap = new Map();
      for (const [index, kind] of (source.registry.value.activityTypes || []).entries()) {
        const id = `rn-kind-${kind.id}`;
        kindMap.set(kind.id, id);
        addTag.run(id, kindCategoryId, `ResearchNote / ${kind.name}`, String(kind.description || ""), Number(kind.order) || index + 1);
      }

      const byDate = new Map();
      for (const log of source.logs.value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(log.timestamp || "")) throw new Error(`日付が不正な活動があります: ${log.id || "IDなし"}`);
        if (!byDate.has(log.timestamp)) byDate.set(log.timestamp, []);
        byDate.get(log.timestamp).push(log);
      }
      const addJournal = database.prepare("INSERT INTO journal_entries(id, entry_date, title, body_markdown, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      const addJournalTag = database.prepare("INSERT INTO journal_tags(journal_id, tag_id) VALUES (?, ?)");
      const addFile = database.prepare("INSERT INTO file_links(id, journal_id, root_id, relative_path, target_type, display_name, note, display_order, created_at) VALUES (?, ?, ?, ?, 'file', ?, ?, ?, ?)");
      let fileCount = 0;
      for (const [date, logs] of byDate) {
        if (database.prepare("SELECT 1 FROM journal_entries WHERE entry_date = ?").get(date)) throw new Error(`${date}の日記が既にあるため、安全のため移行を停止しました。`);
        const journalId = `rn-journal-${date}`;
        const title = logs.length === 1 ? logs[0].title : `${date} のResearchNote記録`;
        const body = logs.map((log) => `## ${log.title}\n\n${log.summary || ""}${Array.isArray(log.people) && log.people.length ? `\n\n参加者: ${log.people.join("、")}` : ""}`).join("\n\n---\n\n");
        addJournal.run(journalId, date, title, body, startedAt, startedAt);
        const tags = new Set(logs.flatMap((log) => [...(log.tags || []).map((id) => tagMap.get(id)).filter(Boolean), kindMap.get(log.kind)].filter(Boolean)));
        for (const tagId of tags) addJournalTag.run(journalId, tagId);
        if (rootId) {
          const seenPaths = new Set();
          for (const file of logs.flatMap((log) => log.files || [])) {
            if (!safeRelativePath(file.path) || seenPaths.has(file.path)) continue;
            seenPaths.add(file.path);
            addFile.run(`rn-file-${randomUUID()}`, journalId, rootId, file.path.replace(/\\/g, "/"), path.basename(file.path), String(file.note || ""), ++fileCount, startedAt);
          }
        }
      }
      const summary = { skipped: false, journals: byDate.size, activitiesArchived: source.logs.value.length, papersArchived: source.papers.value.length, tags: tagMap.size + kindMap.size, files: fileCount, sourceContentHash: source.contentHash };
      database.prepare("UPDATE import_runs SET completed_at = ?, result_json = ? WHERE id = ?").run(new Date().toISOString(), JSON.stringify(summary), runId);
      return summary;
    });
    const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (integrity !== "ok" || foreignKeys.length) throw new Error("移行後のデータベース整合性検査に失敗しました。");
    return result;
  } finally { database.close(); }
}

function cli() {
  const args = process.argv.slice(2);
  const sourceIndex = args.indexOf("--source");
  const rootIndex = args.indexOf("--root-id");
  if (sourceIndex < 0 || !args[sourceIndex + 1]) throw new Error("--source <ResearchNoteのdataフォルダ> を指定してください。");
  const runtimePaths = activePaths();
  ensurePrivateDirectories(runtimePaths);
  const result = importResearchNote({ sourceDirectory: args[sourceIndex + 1], databasePath: runtimePaths.databasePath, rootId: rootIndex >= 0 ? args[rootIndex + 1] || "" : "" });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  try { cli(); } catch (error) { console.error(`移行に失敗しました: ${error.message}`); process.exitCode = 1; }
}

module.exports = { importResearchNote, sourceData };
