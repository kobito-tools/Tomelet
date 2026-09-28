"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DIRECTORY_NAME = "TickTockTome";
// 旧名DailyLogで作られた個人データ領域・DBは、新しい名前のものが無い限りそのまま使う（データは移動しない）。
const LEGACY_DIRECTORY_NAME = "DailyLog";
const DATABASE_FILE_NAME = "ticktocktome.sqlite3";
// 基準パス直下に作る、こびとツール（Tomelet・PopNote!）共通の隠しフォルダ。
//   .kobito-tools/dataset.json  データセットのID（両アプリ共通）と本体の共有設定
//   .kobito-tools/Tomelet/      本体のDB・アップロード・バックアップ
//   .kobito-tools/PopNote/      PopNote!のメモ
//   .kobito-tools/Tags/         両アプリで共有するタグ
const DATASET_DIRECTORY_NAME = ".kobito-tools";
const APP_DATA_DIRECTORY_NAME = "Tomelet";
const POPNOTE_DIRECTORY_NAME = "PopNote";
const TAGS_DIRECTORY_NAME = "Tags";
// 以前の保存先。開いたときに .kobito-tools へ分割移行する。
const LEGACY_DATASET_DIRECTORY_NAME = ".TickTockTome";
const LEGACY_DATABASE_FILE_NAME = "dailylog.sqlite3";
// HOMEは白、設定・使い方は無彩色、Todo〜文書はナビの並び順に虹色（赤→紫）。
const DEFAULT_BATTERY_COLORS = Object.freeze({
  dashboard: "#ffffff", todo: "#e06666", goals: "#ec9a4a", calendar: "#e2c044",
  analysis: "#a3c255", worktree: "#56b27a", files: "#4db3be", books: "#5b8dd9",
  papers: "#9573cf", settings: "#96968f", help: "#96968f",
});
// キャラクターの歩く速さ（px/秒）。
const CHARACTER_SPEEDS = Object.freeze([80, 150, 240, 400]);

function preferCurrent(current, legacy) {
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

function defaultDataDirectory() {
  const override = process.env.TICKTOCKTOME_DATA_DIR || process.env.DAILYLOG_DATA_DIR;
  if (override) return path.resolve(override);
  const base = process.platform === "win32" ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
    : process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return preferCurrent(path.join(base, APP_DIRECTORY_NAME), path.join(base, LEGACY_DIRECTORY_NAME));
}

function databasePathIn(contentDirectory) {
  const databaseDirectory = path.join(contentDirectory, "database");
  return preferCurrent(path.join(databaseDirectory, DATABASE_FILE_NAME), path.join(databaseDirectory, LEGACY_DATABASE_FILE_NAME));
}

function pathsFor(dataDirectory = defaultDataDirectory(), contentDirectory = dataDirectory) {
  return {
    dataDirectory,
    contentDirectory,
    configDirectory: path.join(dataDirectory, "config"),
    databaseDirectory: path.join(contentDirectory, "database"),
    backupDirectory: path.join(contentDirectory, "backups"),
    exportDirectory: path.join(contentDirectory, "exports"),
    runtimeDirectory: path.join(dataDirectory, "runtime"),
    quarantineDirectory: path.join(contentDirectory, "quarantine"),
    uploadsDirectory: path.join(contentDirectory, "uploads"),
    databasePath: databasePathIn(contentDirectory),
    settingPath: path.join(dataDirectory, "config", "setting.json"),
    integrationsPath: path.join(dataDirectory, "config", "integrations.json"),
    runtimeLogPath: path.join(dataDirectory, "runtime", "runtime.log"),
    pidPath: path.join(dataDirectory, "runtime", "server.json"),
  };
}

function ensurePrivateDirectories(paths) {
  for (const directory of [paths.configDirectory, paths.databaseDirectory, paths.backupDirectory, paths.exportDirectory, paths.runtimeDirectory, paths.quarantineDirectory, paths.uploadsDirectory]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}

function readJsonIfPresent(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`${path.basename(filePath)}を読み取れません。JSON形式を確認してください。`);
  }
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const previous = `${filePath}.${process.pid}.${Date.now()}.previous`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    if (fs.existsSync(filePath)) fs.renameSync(filePath, previous);
    fs.renameSync(temporary, filePath);
    fs.rmSync(previous, { force: true });
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(previous) && !fs.existsSync(filePath)) fs.renameSync(previous, filePath);
    throw error;
  }
}

const THEME_DEFAULTS = Object.freeze({ background: "#f4f1ea", surface: "#eeebe4", accent: "#e3654f", text: "#22282d" });
const FONT_PRESETS = Object.freeze(["classic", "modern", "rounded", "handwriting", "mincho"]);

// 配色・フォント・タグ表示は基準パスのデータセットへ保存する共有設定。
function normalizeSharedSettings(saved = {}) {
  const theme = Object.fromEntries(Object.entries(THEME_DEFAULTS).map(([key, fallback]) => [key, /^#[0-9a-fA-F]{6}$/.test(saved.theme?.[key] || "") ? saved.theme[key].toLowerCase() : fallback]));
  const themeMode = saved.themeMode === "manual" ? "manual" : "auto";
  const batteryColors = Object.fromEntries(Object.entries(DEFAULT_BATTERY_COLORS).map(([view, fallback]) => [view, /^#[0-9a-fA-F]{6}$/.test(saved.batteryColors?.[view] || "") ? saved.batteryColors[view].toLowerCase() : fallback]));
  const hiddenTagIds = Array.isArray(saved.hiddenTagIds) ? [...new Set(saved.hiddenTagIds.filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)))] : [];
  const fontPreset = FONT_PRESETS.includes(saved.fontPreset) ? saved.fontPreset : "classic";
  const illumination = saved.illumination !== false;
  const characterSpeed = CHARACTER_SPEEDS.includes(saved.characterSpeed) ? saved.characterSpeed : 150;
  // PopNote!のメモを本体にも表示するか。null は未回答（PopNote!のデータが見つかったときに尋ねる）。
  const showPopNoteMemos = typeof saved.showPopNoteMemos === "boolean" ? saved.showPopNoteMemos : null;
  return { theme, themeMode, batteryColors, fontPreset, hiddenTagIds, illumination, characterSpeed, showPopNoteMemos };
}

function normalizeLocalLlm(saved) {
  const llm = saved && typeof saved === "object" ? saved : {};
  return { enabled: Boolean(llm.enabled), analysisMode: ["off", "manual", "auto"].includes(llm.analysisMode) ? llm.analysisMode : "off", executablePath: typeof llm.executablePath === "string" ? llm.executablePath : "", modelPath: typeof llm.modelPath === "string" ? llm.modelPath : "", pdfTextPath: typeof llm.pdfTextPath === "string" ? llm.pdfTextPath : "" };
}

// schemaVersion 1の種類別基準パス・保存先は、基準パスへ移行するまで legacy として保持する。
function legacyFrom(saved, paths) {
  if (saved.legacy && typeof saved.legacy === "object") return saved.legacy;
  if ((saved.schemaVersion || 1) >= 2) return null;
  const fileRoots = Array.isArray(saved.fileRoots) ? saved.fileRoots.filter((root) => root && typeof root.id === "string" && typeof root.absolutePath === "string") : [];
  // 旧「まなびの本」だけを設定していた環境でも、統合後の「書籍」を引き継ぐ。
  const legacyTextbookRoot = fileRoots.find((root) => root.id === "textbooks");
  if (legacyTextbookRoot && !fileRoots.some((root) => root.id === "books")) fileRoots.push({ ...legacyTextbookRoot, id: "books", displayName: "書籍" });
  const contentDirectory = typeof saved.contentDirectory === "string" && path.isAbsolute(saved.contentDirectory) ? path.resolve(saved.contentDirectory) : paths.dataDirectory;
  return { fileRoots, contentDirectory, ...normalizeSharedSettings(saved) };
}

// このPCで開いたことのある基準パスの一覧。画面右上から切り替えるために使う。
function normalizeKnownDatasets(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((entry) => entry && typeof entry.basePath === "string" && path.isAbsolute(entry.basePath) && !seen.has(entry.basePath) && seen.add(entry.basePath))
    .slice(0, 30)
    .map((entry) => ({ basePath: path.resolve(entry.basePath), datasetId: typeof entry.datasetId === "string" ? entry.datasetId.slice(0, 60) : "", lastOpenedAt: typeof entry.lastOpenedAt === "string" ? entry.lastOpenedAt : null }));
}

function loadSettings(paths) {
  const saved = readJsonIfPresent(paths.settingPath) || {};
  const port = Number(process.env.TICKTOCKTOME_PORT || process.env.DAILYLOG_PORT || saved.port || 3174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ポート番号は1024〜65535の整数にしてください。");
  const revision = Number.isSafeInteger(saved.revision) && saved.revision >= 1 ? saved.revision : 1;
  const legacy = legacyFrom(saved, paths);
  const basePath = typeof saved.basePath === "string" && path.isAbsolute(saved.basePath) ? path.resolve(saved.basePath) : null;
  const machineId = typeof saved.machineId === "string" && /^[A-Za-z0-9-]{8,80}$/.test(saved.machineId) ? saved.machineId : null;
  // データセットを開くまでは、旧設定の外見を表示に使う。
  const shared = normalizeSharedSettings(legacy || {});
  return { schemaVersion: 2, revision, port, machineId, basePath, knownDatasets: normalizeKnownDatasets(saved.knownDatasets), language: saved.language === "en" ? "en" : "ja", localLlm: normalizeLocalLlm(saved.localLlm), legacy, datasetId: null, fileRoots: [], ...shared };
}

// PC固有設定（setting.json）に残すのは基準パスとPCに依存する項目だけ。
function machineRecord(settings) {
  return { schemaVersion: 2, revision: settings.revision, port: settings.port, machineId: settings.machineId, basePath: settings.basePath, knownDatasets: settings.knownDatasets || [], language: settings.language === "en" ? "en" : "ja", localLlm: settings.localLlm, ...(settings.legacy ? { legacy: settings.legacy } : {}) };
}

function kobitoDirectoryFor(basePath) {
  return path.join(basePath, DATASET_DIRECTORY_NAME);
}

// 本体のデータ（DB・アップロードなど）を置くフォルダ。
function datasetDirectoryFor(basePath) {
  return path.join(kobitoDirectoryFor(basePath), APP_DATA_DIRECTORY_NAME);
}

function popnoteDirectoryFor(basePath) {
  return path.join(kobitoDirectoryFor(basePath), POPNOTE_DIRECTORY_NAME);
}

function tagsFileFor(basePath) {
  return path.join(kobitoDirectoryFor(basePath), TAGS_DIRECTORY_NAME, "tags.json");
}

function legacyDatasetDirectoryFor(basePath) {
  return path.join(basePath, LEGACY_DATASET_DIRECTORY_NAME);
}

// 保守ツール用：現在の基準パスのデータセット、未移行なら旧保存先のパスを返す。
function activePaths(machinePaths = pathsFor()) {
  const settings = loadSettings(machinePaths);
  if (settings.basePath) return pathsFor(machinePaths.dataDirectory, datasetDirectoryFor(settings.basePath));
  return pathsFor(machinePaths.dataDirectory, settings.legacy?.contentDirectory || machinePaths.dataDirectory);
}

module.exports = { APP_DATA_DIRECTORY_NAME, CHARACTER_SPEEDS, DATASET_DIRECTORY_NAME, DEFAULT_BATTERY_COLORS, LEGACY_DATASET_DIRECTORY_NAME, POPNOTE_DIRECTORY_NAME, TAGS_DIRECTORY_NAME, activePaths, databasePathIn, datasetDirectoryFor, kobitoDirectoryFor, legacyDatasetDirectoryFor, popnoteDirectoryFor, tagsFileFor, defaultDataDirectory, ensurePrivateDirectories, loadSettings, machineRecord, normalizeLocalLlm, normalizeSharedSettings, pathsFor, readJsonIfPresent, writeJsonAtomic };
