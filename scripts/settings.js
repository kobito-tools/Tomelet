"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const APP_DIRECTORY_NAME = "TickTockTome";
// 旧名DailyLogで作られた個人データ領域・DBは、新しい名前のものが無い限りそのまま使う（データは移動しない）。
const LEGACY_DIRECTORY_NAME = "DailyLog";
const DATABASE_FILE_NAME = "ticktocktome.sqlite3";
const LEGACY_DATABASE_FILE_NAME = "dailylog.sqlite3";

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

function loadSettings(paths) {
  const saved = readJsonIfPresent(paths.settingPath) || {};
  const port = Number(process.env.TICKTOCKTOME_PORT || process.env.DAILYLOG_PORT || saved.port || 3174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ポート番号は1024〜65535の整数にしてください。");
  const fileRoots = Array.isArray(saved.fileRoots) ? saved.fileRoots.filter((root) => root && typeof root.id === "string" && typeof root.absolutePath === "string") : [];
  const revision = Number.isSafeInteger(saved.revision) && saved.revision >= 1 ? saved.revision : 1;
  const defaults = { background: "#f4f1ea", surface: "#eeebe4", accent: "#e3654f", text: "#22282d" };
  const theme = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, /^#[0-9a-fA-F]{6}$/.test(saved.theme?.[key] || "") ? saved.theme[key].toLowerCase() : fallback]));
  const contentDirectory = typeof saved.contentDirectory === "string" && path.isAbsolute(saved.contentDirectory) ? path.resolve(saved.contentDirectory) : paths.dataDirectory;
  const hiddenTagIds = Array.isArray(saved.hiddenTagIds) ? [...new Set(saved.hiddenTagIds.filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)))] : [];
  const fontPreset = ["classic","modern","rounded","handwriting","mincho"].includes(saved.fontPreset) ? saved.fontPreset : "classic";
  const llm=saved.localLlm&&typeof saved.localLlm==="object"?saved.localLlm:{};
  const localLlm={enabled:Boolean(llm.enabled),analysisMode:["off","manual","auto"].includes(llm.analysisMode)?llm.analysisMode:"off",executablePath:typeof llm.executablePath==="string"?llm.executablePath:"",modelPath:typeof llm.modelPath==="string"?llm.modelPath:"",pdfTextPath:typeof llm.pdfTextPath==="string"?llm.pdfTextPath:""};
  return { schemaVersion: 1, revision, port, fileRoots, theme, fontPreset, localLlm, contentDirectory, hiddenTagIds };
}

module.exports = { databasePathIn, defaultDataDirectory, ensurePrivateDirectories, loadSettings, pathsFor, readJsonIfPresent, writeJsonAtomic };
