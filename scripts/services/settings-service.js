"use strict";

const path = require("node:path");
const { validateDatasetId } = require("../dataset.js");
const { CHARACTER_SPEEDS } = require("../settings.js");

function staleRevision() {
  const error = new Error("設定が別の画面で変更されました。再読み込みしてください。");
  error.statusCode = 409;
  return error;
}

// persist(scope)は、scopeが"shared"なら基準パスのデータセットへ、"machine"ならこのPCの設定へ書き込む。
function commit(settings, persist, scope, changes) {
  const next = { ...settings, ...changes, revision: settings.revision + 1 };
  persist(scope, next);
  Object.assign(settings, changes, { revision: next.revision });
  return next.revision;
}

function updateTheme(settings, persist, input) {
  const expectedRevision = Number(input?.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== settings.revision) throw staleRevision();
  const theme = {};
  for (const key of ["background", "surface", "accent", "text"]) {
    const value = String(input.theme?.[key] || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error("配色は6桁のカラーコードで指定してください。");
    theme[key] = value;
  }
  const themeMode = String(input.themeMode || "");
  if (!["auto", "manual"].includes(themeMode)) throw new Error("外見モードを選択してください。");
  const batteryColors = {};
  for (const view of ["dashboard", "todo", "goals", "calendar", "analysis", "worktree", "files", "books", "papers", "settings", "help"]) {
    const value = String(input.batteryColors?.[view] || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error("ページ配色は6桁のカラーコードで指定してください。");
    batteryColors[view] = value;
  }
  const revision = commit(settings, persist, "shared", { theme, themeMode, batteryColors });
  return { theme, themeMode, batteryColors, revision };
}

function updateTagVisibility(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  const hiddenTagIds = [...new Set(Array.isArray(input.hiddenTagIds) ? input.hiddenTagIds.map(String) : [])];
  if (hiddenTagIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("タグ表示設定が正しくありません。");
  return { hiddenTagIds, revision: commit(settings, persist, "shared", { hiddenTagIds }) };
}
function updateFontPreset(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  const fontPreset=String(input.fontPreset||"");
  if(!["classic","modern","rounded","handwriting","mincho"].includes(fontPreset))throw new Error("フォントを選択してください。");
  return {fontPreset,revision:commit(settings,persist,"shared",{fontPreset})};
}
function updateLocalLlm(settings,persist,input){
  if(Number(input?.revision)!==settings.revision)throw staleRevision();
  const localLlm={enabled:Boolean(input.enabled),analysisMode:["off","manual","auto"].includes(String(input.analysisMode))?String(input.analysisMode):"off",executablePath:String(input.executablePath||"").trim(),modelPath:String(input.modelPath||"").trim(),pdfTextPath:String(input.pdfTextPath||"").trim()};
  if(!localLlm.enabled)localLlm.analysisMode="off";
  if(localLlm.enabled){for(const [key,label] of [["executablePath","llama.cpp実行ファイル"],["modelPath","GGUFモデル"],["pdfTextPath","pdftotext実行ファイル"]]){if(!path.isAbsolute(localLlm[key]))throw new Error(`${label}の絶対パスを入力してください。`);}}
  return {localLlm,revision:commit(settings,persist,"machine",{localLlm})};
}

// ページの照明演出（豆電球と同期した色の切替）とキャラクターの速さ。
function updateMotion(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  const characterSpeed = Number(input.characterSpeed);
  if (!CHARACTER_SPEEDS.includes(characterSpeed)) throw new Error("キャラクターの速さを選択してください。");
  const illumination = Boolean(input.illumination);
  return { illumination, characterSpeed, revision: commit(settings, persist, "shared", { illumination, characterSpeed }) };
}

// PopNote!のメモを本体にも表示するか（データセットの共有設定）。
function updatePopNoteMemos(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  if (typeof input.show !== "boolean") throw new Error("表示する・しないを選択してください。");
  return { showPopNoteMemos: input.show, revision: commit(settings, persist, "shared", { showPopNoteMemos: input.show }) };
}

function updatePastephantMemos(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  if (typeof input.show !== "boolean") throw new Error("表示する・しないを選択してください。");
  return { showPastephantMemos: input.show, revision: commit(settings, persist, "shared", { showPastephantMemos: input.show }) };
}

// ナビゲーションの表示言語（このPCだけの設定）。
function updateLanguage(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  const language = String(input.language || "");
  if (!["ja", "en"].includes(language)) throw new Error("表示言語を選択してください。");
  return { language, revision: commit(settings, persist, "machine", { language }) };
}

function updateDatasetId(settings, persist, input) {
  if (Number(input?.revision) !== settings.revision) throw staleRevision();
  const datasetId = validateDatasetId(input.datasetId);
  return { datasetId, revision: commit(settings, persist, "shared", { datasetId }) };
}

module.exports = { updateDatasetId, updateFontPreset, updateLanguage, updateMotion, updateLocalLlm, updatePastephantMemos, updatePopNoteMemos, updateTagVisibility, updateTheme };
