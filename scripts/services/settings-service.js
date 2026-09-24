"use strict";

const path = require("node:path");
const { writeJsonAtomic } = require("../settings.js");

function savedSettings(settings, revision, overrides = {}) {
  return { schemaVersion: 1, revision, port: settings.port, fileRoots: settings.fileRoots, theme: settings.theme, fontPreset: settings.fontPreset || "classic", localLlm: settings.localLlm || {enabled:false,executablePath:"",modelPath:"",pdfTextPath:""}, hiddenTagIds: settings.hiddenTagIds || [], contentDirectory: settings.contentDirectory, ...overrides };
}

function validateRootInput(input) {
  if (!input || !/^[A-Za-z0-9_-]{1,80}$/.test(input.id || "")) throw new Error("基準フォルダIDは英数字・_・-で入力してください。");
  const displayName = String(input.displayName || "").trim();
  if (!displayName || displayName.length > 200) throw new Error("基準フォルダの表示名を入力してください。");
  return { id: input.id, displayName };
}

function upsertFileRoot(settings, settingPath, input, absolutePath) {
  const expectedRevision = Number(input.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== settings.revision) { const error = new Error("設定が別の画面で変更されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
  const root = validateRootInput(input);
  if (!path.isAbsolute(absolutePath)) throw new Error("選択したフォルダのパスが正しくありません。");
  const index = settings.fileRoots.findIndex((item) => item.id === root.id);
  if (index >= 0 && !input.replace) { const error = new Error("同じ内部IDが登録済みです。"); error.statusCode = 409; throw error; }
  const nextRoots = settings.fileRoots.map((item) => ({ ...item }));
  const next = { ...root, absolutePath };
  if (index >= 0) nextRoots[index] = next;
  else nextRoots.push(next);
  const saved = savedSettings(settings, settings.revision + 1, { fileRoots: nextRoots });
  writeJsonAtomic(settingPath, saved);
  settings.revision = saved.revision;
  settings.fileRoots = saved.fileRoots;
  return { id: root.id, displayName: root.displayName, available: true, revision: saved.revision, replaced: index >= 0 };
}

function updateTheme(settings, settingPath, input) {
  const expectedRevision = Number(input?.revision);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== settings.revision) { const error = new Error("設定が別の画面で変更されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
  const theme = {};
  for (const key of ["background", "surface", "accent", "text"]) {
    const value = String(input.theme?.[key] || "").toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(value)) throw new Error("配色は6桁のカラーコードで指定してください。");
    theme[key] = value;
  }
  const saved = savedSettings(settings, settings.revision + 1, { theme });
  writeJsonAtomic(settingPath, saved);
  settings.revision = saved.revision;
  settings.theme = theme;
  return { theme, revision: saved.revision };
}

function updateTagVisibility(settings, settingPath, input) {
  if (Number(input?.revision) !== settings.revision) { const error = new Error("設定が別の画面で変更されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
  const hiddenTagIds = [...new Set(Array.isArray(input.hiddenTagIds) ? input.hiddenTagIds.map(String) : [])];
  if (hiddenTagIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("タグ表示設定が正しくありません。");
  const saved = savedSettings(settings, settings.revision + 1, { hiddenTagIds });
  writeJsonAtomic(settingPath, saved); settings.revision = saved.revision; settings.hiddenTagIds = hiddenTagIds;
  return { hiddenTagIds, revision: saved.revision };
}
function updateFontPreset(settings, settingPath, input) {
  if (Number(input?.revision) !== settings.revision) { const error = new Error("設定が別の画面で変更されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
  const fontPreset=String(input.fontPreset||"");
  if(!["classic","modern","rounded","handwriting","mincho"].includes(fontPreset))throw new Error("フォントを選択してください。");
  const saved=savedSettings(settings,settings.revision+1,{fontPreset});
  writeJsonAtomic(settingPath,saved);settings.revision=saved.revision;settings.fontPreset=fontPreset;
  return {fontPreset,revision:saved.revision};
}
function updateLocalLlm(settings,settingPath,input){
  if(Number(input?.revision)!==settings.revision){const error=new Error("設定が別の画面で変更されました。再読み込みしてください。");error.statusCode=409;throw error;}
  const localLlm={enabled:Boolean(input.enabled),analysisMode:["off","manual","auto"].includes(String(input.analysisMode))?String(input.analysisMode):"off",executablePath:String(input.executablePath||"").trim(),modelPath:String(input.modelPath||"").trim(),pdfTextPath:String(input.pdfTextPath||"").trim()};
  if(!localLlm.enabled)localLlm.analysisMode="off";
  if(localLlm.enabled){for(const [key,label] of [["executablePath","llama.cpp実行ファイル"],["modelPath","GGUFモデル"],["pdfTextPath","pdftotext実行ファイル"]]){if(!path.isAbsolute(localLlm[key]))throw new Error(`${label}の絶対パスを入力してください。`);}}
  const saved=savedSettings(settings,settings.revision+1,{localLlm});writeJsonAtomic(settingPath,saved);settings.revision=saved.revision;settings.localLlm=localLlm;return {localLlm,revision:saved.revision};
}

module.exports = { updateFontPreset, updateLocalLlm, updateTagVisibility, updateTheme, upsertFileRoot, validateRootInput };
