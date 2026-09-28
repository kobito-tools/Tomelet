"use strict";

// 使い方ページの図（assets/help-*.svg）から英語版（help-*.en.svg）を生成する。
// 図の文字を変更したら `node tools/build-help-svg-en.js` を実行する。訳が無い文字が残っていれば失敗する。
const fs = require("node:fs");
const path = require("node:path");

const assets = path.resolve(__dirname, "..", "assets");
const english = {
  "09/09　実験メモ": "09/09  Lab notes", "09/12　論文を読む": "09/12  Read a paper", "09/15　資料を整理": "09/15  Sort materials",
  "09:00–10:30　資料を整理　　達成度 75%": "09:00–10:30  Sort materials  Progress 75%",
  "PDFと表紙を使った本棚形式の資料管理図": "A bookshelf of PDFs and covers", "PDFをここへドロップ": "Drop PDFs here", "PDF先頭ページ": "PDF first page",
  "Tomeletが保存": "Tomelet saves", "Todoや時間割に添付したファイルを関連作業から検索する図": "Finding attached files by related work",
  "Todo：読書メモを書く": "Todo: Write reading notes", "≡ 日刊記録": "≡ Daily log", "▦ カレンダー": "▦ Calendar", "◎ 時間割": "◎ Schedule",
  "このPCだけの設定": "This PC only", "カレンダー": "Calendar", "タグごとの縦線がアクションをつなぐ図": "Tag lines connecting actions",
  "タグ：プロジェクトA": "Tag: Project A", "ドラッグして移動": "Drag to move", "ファイル": "Files", "プロジェクト": "Project",
  "・ID、外見の設定": "· ID & appearance", "・ポート番号": "· Port number", "・日記・時間割（SQLite）": "· Journals & schedule (SQLite)",
  "・現在の基準パス": "· Current base path", "・表紙・添付・バックアップ": "· Covers, files, backups", "・連携トークン": "· Integration tokens",
  "今日の記録": "Today's record", "作業ツリー": "Work Tree", "分離": "Separate", "名前": "Name", "名前・タグ・関連する作業で検索": "Search by name, tag, or work",
  "基準パス/.kobito-tools": "Base path/.kobito-tools", "基準パスとこのPCの設定": "Base path and this PC", "基準パスは1か所だけ": "A single base path",
  "基準パス（1か所）": "Base path (one)", "報告書を仕上げる": "Finish the report", "場所: 基準パス": "Where: base path", "完了": "Done",
  "実行中｜報告書を仕上げる": "Running | Finish the report", "実験ノート整理": "Tidy lab notes", "常駐OFF": "Unpin", "文書": "Documents",
  "日刊記録": "Daily log", "日刊記録の日付カード": "Daily log date card", "時間割": "Schedule", "時間割と記録が同じ日付カードにまとまる図": "Schedule and records on one date card",
  "時間割：報告書をまとめる": "Schedule: Write the report", "期限日": "Due date", "本と文書の棚": "Books and documents shelf", "本のタイトル": "Book title",
  "本・文書の棚": "Books & documents", "本文・タグ・関連ファイルを追加": "Add text, tags, and files", "登録が新しい順　⌄": "Newest added  ⌄",
  "相対位置:": "Relative path:", "研究室　0%": "Lab  0%", "管理ファイル一覧": "Managed files", "絶対パスはDBに保存しない": "No absolute paths in the DB",
  "自宅　50%": "Home  50%", "著者・状態・タグ": "Author · status · tags", "論文を読む": "Read a paper", "資料を読む": "Read materials", "資料作成": "Materials",
  "達成度": "Progress", "＋ Todoを追加": "+ Add Todo",
  "日": "Sun", "月": "Mon", "火": "Tue", "水": "Wed", "木": "Thu", "金": "Fri", "土": "Sat",
};

const japanese = /[぀-ヿ㐀-鿿]/;
const missing = new Set();
const escape = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

for (const name of fs.readdirSync(assets).filter((file) => /^help-[a-z-]+\.svg$/.test(file))) {
  const source = fs.readFileSync(path.join(assets, name), "utf8");
  const translated = source.replace(/>([^<>]*)</g, (whole, text) => {
    if (!japanese.test(text)) return whole;
    const key = text.trim();
    if (!Object.hasOwn(english, key)) { missing.add(`${name}: ${key}`); return whole; }
    return `>${escape(english[key])}<`;
  });
  fs.writeFileSync(path.join(assets, name.replace(/\.svg$/, ".en.svg")), translated);
}

if (missing.size) {
  console.error(`英訳の無い文字があります:\n${[...missing].join("\n")}`);
  process.exitCode = 1;
} else console.log("help-*.en.svg を生成しました。");
