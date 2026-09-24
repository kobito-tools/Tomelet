"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { openDatabase } = require("../scripts/database/connection.js");
const { SqliteRepository } = require("../scripts/repositories/sqlite-repository.js");
const { ensurePrivateDirectories, pathsFor, writeJsonAtomic } = require("../scripts/settings.js");

const projectRoot = path.resolve(__dirname, "..");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function main() {
  const requested = argument("--data-dir");
  if (!requested) throw new Error("実データとの混同を防ぐため、--data-dir <デモ専用フォルダ> が必要です。");
  const dataDirectory = path.resolve(requested);
  const runtimePaths = pathsFor(dataDirectory);
  ensurePrivateDirectories(runtimePaths);
  const demoFiles = path.join(dataDirectory, "demo-files");
  fs.mkdirSync(path.join(demoFiles, "notes"), { recursive: true });
  fs.mkdirSync(path.join(demoFiles, "references"), { recursive: true });
  fs.writeFileSync(path.join(demoFiles, "notes", "reading-notes.md"), "# 架空の読書メモ\n\nTick Tock Tomeの使用感確認用です。\n");
  fs.writeFileSync(path.join(demoFiles, "references", "example-paper.txt"), "TickTockTome demo file.\n");
  writeJsonAtomic(runtimePaths.settingPath, { schemaVersion: 1, revision: 1, port: 43177, fileRoots: [
    { id: "files", displayName: "ファイル", absolutePath: demoFiles },
    { id: "books", displayName: "くらしの本", absolutePath: demoFiles },
    { id: "textbooks", displayName: "まなびの本", absolutePath: demoFiles },
    { id: "papers", displayName: "論文", absolutePath: demoFiles },
  ], theme: { background: "#f4f1ea", surface: "#eeebe4", accent: "#e3654f", text: "#22282d" }, localLlm: { enabled: false, executablePath: "", modelPath: "", pdfTextPath: "" } });

  const database = openDatabase(runtimePaths.databasePath, projectRoot, runtimePaths.backupDirectory);
  try {
    const repository = new SqliteRepository(database);
    if (repository.dashboard().totals.journals || database.prepare("SELECT count(*) AS count FROM library_items").get().count) throw new Error("指定先には既にデータがあります。空のデモ専用フォルダを指定してください。");
    [
      { id: "daily-review", categoryId: "other", name: "振り返り", description: "日々の振り返り", displayOrder: 1 },
      { id: "app-design", categoryId: "theme", name: "アプリ設計", description: "画面・データ設計", displayOrder: 1 },
      { id: "reading", categoryId: "theme", name: "読書", description: "読書記録", displayOrder: 2 },
      { id: "statistics", categoryId: "theme", name: "統計", description: "統計学", displayOrder: 3 },
      { id: "programming", categoryId: "tool", name: "プログラミング", description: "ソフトウェア開発", displayOrder: 1 },
    ].forEach((tag) => repository.createTag(tag));

    const journals = [
      ["2026-09-08", "Tick Tock Tomeを使い始めた", "## 今日の記録\n\n画面を確認し、残したい情報を整理した。", ["daily-review", "app-design"]],
      ["2026-09-09", "読書メモの整理", "書籍と教科書を分けて管理する方針を考えた。", ["reading", "app-design"]],
      ["2026-09-10", "統計の復習", "平均と分散について教科書を読み直した。", ["reading", "statistics"]],
      ["2026-09-11", "資料管理画面を確認", "論文の状態別ボードとタグ分類表を試した。", ["daily-review", "reading", "programming"]],
    ].map(([entryDate, title, bodyMarkdown, tagIds]) => repository.createJournal({ entryDate, title, bodyMarkdown, tagIds, projectIds: [], files: entryDate === "2026-09-09" ? [{ rootId: "files", relativePath: "notes/reading-notes.md", targetType: "file", displayName: "架空の読書メモ", note: "デモ用" }] : [] }));

    const items = [
      ["book", "未読", "架空都市の小さな図書館", ["山田 花子"], 2022, "サンプル出版", "unread", 4, ["reading"]],
      ["book", "読書中", "考えるための散歩道", ["佐藤 太郎"], 2024, "例示書房", "reading", 5, ["reading", "daily-review"]],
      ["book", "読了", "静かな朝の記録術", ["鈴木 一郎"], 2021, "デモ社", "read", 3, ["daily-review"]],
      ["textbook", "未読", "はじめてのデータ整理", ["高橋 例子"], 2025, "第1版・サンプル出版", "unread", 5, ["programming"]],
      ["textbook", "読書中", "基礎から学ぶ統計", ["田中 学"], 2023, "第2版・例示書房", "reading", 4, ["statistics", "reading"]],
      ["textbook", "読了", "ローカルアプリ設計入門", ["伊藤 開発"], 2024, "第1版・デモ社", "read", 4, ["app-design", "programming"]],
      ["paper", "未読", "Example Study on Personal Archives", ["A. Example", "B. Sample"], 2025, "Journal of Example Studies", "unread", 5, ["app-design"]],
      ["paper", "読書中", "Local-first Information Management: A Demo", ["C. Test"], 2026, "Demo Conference", "reading", 5, ["app-design", "programming"]],
      ["paper", "参照済み", "Tag-based Reflection in Sample Systems", ["D. Placeholder"], 2024, "Sample Workshop", "cited", 3, ["daily-review", "statistics"]],
    ];
    items.forEach(([itemType, stateLabel, title, authors, year, publication, status, priority, tagIds], index) => repository.createLibraryItem({ itemType, title, authors, year, publication, status, priority, favorite: index % 3 === 1, keywords: itemType === "paper" ? ["local-first", "personal archive"] : [], doi: itemType === "paper" ? `10.5555/ticktocktome.demo.${index + 1}` : "", bibtexCode: itemType === "paper" ? `@article{Demo${year}Tick Tock Tome${index + 1},\n  title = {${title}},\n  year = {${year}}\n}` : "", takeawayMarkdown: `## ${stateLabel}のサンプル\n\nこれはTick Tock Tomeの表示と編集を試すための**架空データ**です。\n\n行内数式の例：$E = mc^2$`, url: `https://example.com/ticktocktome-demo-${index + 1}`, tagIds, journalIds: [journals[index % journals.length].id] }));

    repository.upsertActivityBatch({ id: "demo-logger", name: "Demo Activity Logger" }, [
      { externalId: "demo-event-1", startedAt: "2026-09-11T09:00:00+09:00", endedAt: "2026-09-11T10:15:00+09:00", applicationName: "Example Editor", windowTitle: "TickTockTome UI mock", rootId: null, relativePath: null, projectName: "", sourceRevision: 1, sourceUpdatedAt: null },
      { externalId: "demo-event-2", startedAt: "2026-09-11T14:00:00+09:00", endedAt: "2026-09-11T14:40:00+09:00", applicationName: "Example Reader", windowTitle: "基礎から学ぶ統計", rootId: null, relativePath: null, projectName: "", sourceRevision: 1, sourceUpdatedAt: null },
    ]);
    const readingFile=repository.createManagedFile("files","notes/reading-notes.md");
    const exampleFile=repository.createManagedFile("files","references/example-paper.txt");
    repository.createDailyAction({ actionDate: "2026-09-14", startTime: "09:00", endTime: "10:30", action: "一日の予定を整理する", location: "自宅", progress: 100, displayOrder: 1, tagIds: ["daily-review"], completions: ["優先順位を決めた"], fileIds: [], managedFileIds: [readingFile.id], libraryIds: [], uploadIds: [], todoId: "" });
    repository.createDailyAction({ actionDate: "2026-09-14", startTime: "14:00", endTime: "16:00", action: "Tick Tock Tomeの画面を試す", location: "自宅", progress: 50, displayOrder: 2, tagIds: ["app-design", "programming"], completions: ["今日の目標を入力した"], fileIds: [], managedFileIds: [exampleFile.id], libraryIds: [], uploadIds: [], todoId: "" });
  } finally { database.close(); }
  console.log(`デモデータを作成しました: ${dataDirectory}\n起動ポート: 43177`);
}

try { main(); } catch (error) { console.error(`デモ作成に失敗しました: ${error.message}`); process.exitCode = 1; }
