"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { updateDatasetId, updateFontPreset, updateLanguage, updateLocalLlm, updateMotion, updateTheme } = require("../../scripts/services/settings-service.js");

// 保存先ごとの書き込みを記録する。
function recorder() {
  const writes = [];
  return { writes, persist: (scope, next) => writes.push({ scope, next }) };
}

test("共有設定はデータセットへ、LLMの場所はこのPCへ保存する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, fontPreset: "classic", localLlm: { enabled: false } };
  updateFontPreset(settings, persist, { revision: 1, fontPreset: "handwriting" });
  updateLocalLlm(settings, persist, { revision: 2, enabled: false });
  assert.deepEqual(writes.map((write) => write.scope), ["shared", "machine"]);
  assert.equal(settings.revision, 3);
});

test("同梱フォントの選択を保存し、未対応の値を拒否する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, fontPreset: "classic" };
  const result = updateFontPreset(settings, persist, { revision: 1, fontPreset: "handwriting" });
  assert.equal(result.fontPreset, "handwriting");
  assert.equal(writes[0].next.fontPreset, "handwriting");
  assert.throws(() => updateFontPreset(settings, persist, { revision: 1, fontPreset: "classic" }), /再読み込み/);
  assert.throws(() => updateFontPreset(settings, persist, { revision: 2, fontPreset: "system-font" }), /フォント/);
});

test("自動テーマとページごとの配色をまとめて保存する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, themeMode: "auto", batteryColors: {} };
  const theme = { background: "#f4f1ea", surface: "#eeebe4", accent: "#e3654f", text: "#22282d" };
  const batteryColors = { dashboard: "#96968f", todo: "#d96767", goals: "#d9914f", calendar: "#c7ad4a", analysis: "#91ad52", worktree: "#5fa870", files: "#55a7a3", books: "#5d8fbe", papers: "#8a70b2", settings: "#96968f", help: "#96968f" };
  const result = updateTheme(settings, persist, { revision: 1, themeMode: "auto", theme, batteryColors });
  assert.equal(result.themeMode, "auto");
  assert.deepEqual(writes[0].next.batteryColors, batteryColors);
  assert.throws(() => updateTheme(settings, persist, { revision: 2, themeMode: "automatic", theme, batteryColors }), /外見モード/);
});

test("データセットのIDを検証して変更する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, datasetId: "旧ID" };
  assert.equal(updateDatasetId(settings, persist, { revision: 1, datasetId: "  研究用  " }).datasetId, "研究用");
  assert.equal(writes[0].scope, "shared");
  assert.throws(() => updateDatasetId(settings, persist, { revision: 2, datasetId: "" }), /1〜60文字/);
  assert.throws(() => updateDatasetId(settings, persist, { revision: 2, datasetId: "a\nb" }), /制御文字/);
});

test("旧名DailyLogのDBは新しいDBが無い間だけ使い続ける", () => {
  const { pathsFor } = require("../../scripts/settings.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-legacy-"));
  try {
    const databaseDirectory = path.join(directory, "database");
    fs.mkdirSync(databaseDirectory);
    assert.equal(pathsFor(directory).databasePath, path.join(databaseDirectory, "ticktocktome.sqlite3"));
    fs.writeFileSync(path.join(databaseDirectory, "dailylog.sqlite3"), "");
    assert.equal(pathsFor(directory).databasePath, path.join(databaseDirectory, "dailylog.sqlite3"));
    fs.writeFileSync(path.join(databaseDirectory, "ticktocktome.sqlite3"), "");
    assert.equal(pathsFor(directory).databasePath, path.join(databaseDirectory, "ticktocktome.sqlite3"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("旧設定の種類別基準パスは移行用に保持し、まなびの本は書籍として引き継ぐ", () => {
  const { loadSettings, pathsFor } = require("../../scripts/settings.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-book-root-"));
  const paths = pathsFor(directory);
  fs.mkdirSync(paths.configDirectory, { recursive: true });
  fs.writeFileSync(paths.settingPath, JSON.stringify({ schemaVersion: 1, revision: 1, port: 3174, fontPreset: "mincho", fileRoots: [{ id: "textbooks", displayName: "まなびの本", absolutePath: directory }] }));
  try {
    const settings = loadSettings(paths);
    assert.equal(settings.basePath, null);
    assert.deepEqual(settings.fileRoots, []);
    assert.equal(settings.fontPreset, "mincho");
    assert.equal(settings.legacy.fileRoots.find((root) => root.id === "books").absolutePath, directory);
    assert.equal(settings.legacy.contentDirectory, directory);
    assert.ok(settings.legacy.fileRoots.some((root) => root.id === "textbooks"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("外見設定がない既存環境は自動モードと既定のページ配色を使う", () => {
  const { loadSettings, pathsFor } = require("../../scripts/settings.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-theme-defaults-"));
  const paths = pathsFor(directory);
  fs.mkdirSync(paths.configDirectory, { recursive: true });
  fs.writeFileSync(paths.settingPath, JSON.stringify({ schemaVersion: 1, revision: 1, port: 3174 }));
  try {
    const settings = loadSettings(paths);
    assert.equal(settings.themeMode, "auto");
    assert.equal(settings.batteryColors.dashboard, "#ffffff");
    assert.equal(settings.batteryColors.help, "#96968f");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("照明演出のON／OFFとキャラクターの速さを共有設定へ保存する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, illumination: true, characterSpeed: 150 };
  const result = updateMotion(settings, persist, { revision: 1, illumination: false, characterSpeed: 400 });
  assert.deepEqual([result.illumination, result.characterSpeed], [false, 400]);
  assert.equal(writes[0].scope, "shared");
  assert.throws(() => updateMotion(settings, persist, { revision: 2, illumination: true, characterSpeed: 999 }), /速さ/);
  const { normalizeSharedSettings } = require("../../scripts/settings.js");
  assert.deepEqual([normalizeSharedSettings({}).illumination, normalizeSharedSettings({}).characterSpeed], [true, 150]);
});

test("ナビゲーションの表示言語はこのPCの設定として保存する", () => {
  const { writes, persist } = recorder();
  const settings = { revision: 1, language: "ja" };
  assert.equal(updateLanguage(settings, persist, { revision: 1, language: "en" }).language, "en");
  assert.equal(writes[0].scope, "machine");
  assert.throws(() => updateLanguage(settings, persist, { revision: 2, language: "fr" }), /表示言語/);
});
