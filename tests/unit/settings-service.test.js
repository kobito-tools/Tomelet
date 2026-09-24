"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { updateFontPreset, upsertFileRoot, validateRootInput } = require("../../scripts/services/settings-service.js");

test("基準フォルダ設定は版を確認して追加・再設定する", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-settings-"));
  const settingPath = path.join(directory, "setting.json");
  const settings = { schemaVersion: 1, revision: 1, port: 3174, fileRoots: [] };
  try {
    const added = upsertFileRoot(settings, settingPath, { id: "documents", displayName: "Documents", revision: 1 }, directory);
    assert.equal(added.revision, 2);
    assert.equal(JSON.parse(fs.readFileSync(settingPath, "utf8")).fileRoots[0].absolutePath, directory);
    assert.throws(() => upsertFileRoot(settings, settingPath, { id: "documents", displayName: "Other", revision: 1, replace: true }, directory), /再読み込み/);
    const replaced = upsertFileRoot(settings, settingPath, { id: "documents", displayName: "資料", revision: 2, replace: true }, directory);
    assert.equal(replaced.replaced, true);
    assert.equal(settings.revision, 3);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("基準フォルダの内部IDと表示名を検証する", () => {
  assert.throws(() => validateRootInput({ id: "../outside", displayName: "不正" }), /英数字/);
  assert.throws(() => validateRootInput({ id: "documents", displayName: "" }), /表示名/);
});

test("同梱フォントの選択を保存し、未対応の値を拒否する", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-font-"));
  const settingPath = path.join(directory, "setting.json");
  const settings = { schemaVersion: 1, revision: 1, port: 3174, fileRoots: [], fontPreset: "classic" };
  try {
    const result = updateFontPreset(settings, settingPath, { revision: 1, fontPreset: "handwriting" });
    assert.equal(result.fontPreset, "handwriting");
    assert.equal(JSON.parse(fs.readFileSync(settingPath, "utf8")).fontPreset, "handwriting");
    assert.throws(() => updateFontPreset(settings, settingPath, { revision: 2, fontPreset: "system-font" }), /フォント/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
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
