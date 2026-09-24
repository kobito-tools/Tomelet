"use strict";

const { createServer } = require("node:http");
const { createHash, randomUUID } = require("node:crypto");
const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } = require("node:fs");
const { readFile, realpath, writeFile, unlink } = require("node:fs/promises");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { openDatabase } = require("./database/connection.js");
const { createVerifiedBackup } = require("./database/backup.js");
const { SqliteRepository } = require("./repositories/sqlite-repository.js");
const { JournalService, safeRelativePath } = require("./services/journal-service.js");
const { updateFontPreset, updateLocalLlm, updateTagVisibility, updateTheme, upsertFileRoot, validateRootInput } = require("./services/settings-service.js");
const { analyzeDailyActivity, extractLibraryMetadata } = require("./services/local-llm-service.js");
const { validDate, validateDailyAction } = require("./services/daily-action-service.js");
const { validateLibraryItem } = require("./services/library-service.js");
const { validateMemo } = require("./services/memo-service.js");
const { companionClient, companions } = require("./integrations/companions.js");
const { authorizeIntegration } = require("./security/integration-auth.js");
const { resolveAllowedTarget } = require("./security/file-paths.js");
const { databasePathIn, ensurePrivateDirectories, loadSettings, pathsFor } = require("./settings.js");

const projectRoot = path.resolve(__dirname, "..");
const machinePaths = pathsFor();
ensurePrivateDirectories(machinePaths);
const settings = loadSettings(machinePaths);
const runtimePaths = pathsFor(machinePaths.dataDirectory, settings.contentDirectory);
ensurePrivateDirectories(runtimePaths);
const database = openDatabase(runtimePaths.databasePath, projectRoot, runtimePaths.backupDirectory);
const repository = new SqliteRepository(database);
const journals = new JournalService(repository, settings);
const thumbnailDirectory = path.join(runtimePaths.runtimeDirectory, "paper-thumbnails");
mkdirSync(thumbnailDirectory, { recursive: true, mode: 0o700 });
function validateLibraryReference(input, editing = false) {
  const value=validateLibraryItem(input,editing);
  if (value.sourceRootId) {
    const expectedRoot={book:"books",textbook:"textbooks",paper:"papers"}[value.itemType];
    if(value.sourceRootId!==expectedRoot)throw new Error("資料種別に対応する基準パスを使用してください。");
    const target=resolveAllowedTarget(settings,value.sourceRootId,value.sourceRelativePath);
    if (!statSync(target).isFile()) throw new Error('PDFファイルを選択してください。');
  }
  return value;
}
const host = "127.0.0.1";
const port = settings.port;
const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const revision = createHash("sha256").update(readFileSync(__filename)).digest("hex").slice(0, 16);
const {timerState,startAction}=require('./services/timer-service.js');
let timerWindowProcess=null;

// 連携メモアプリPopNote!は、初回起動時にscripts/companion-connect.jsで専用トークンを登録する。
// 登録済みならHOMEの「✎」やカレンダーのメモから、URLスキームでPopNote!を開く（macOSのみ）。
function memoCompanion() {
  return process.platform === "darwin" && companionClient(runtimePaths.integrationsPath, "popnote") ? companions.popnote : null;
}

function dailyAnalysisPayload(date){
  const actions=repository.listDailyActions({date,limit:2000}).map(({id,action,startTime,endTime,actualStartTime,actualEndTime,executionStatus,progress,location,tagIds,completions})=>({id,action,plannedStart:startTime,plannedEnd:endTime,actualStart:actualStartTime,actualEnd:actualEndTime,status:executionStatus,progress,location,tagIds,notes:completions}));
  const events=repository.calendarMonth(date.slice(0,7)).filter(item=>item.occurredAt.slice(0,10)===date).map(({eventType,title,description,occurredAt})=>({eventType,title,description,occurredAt}));
  return {date,actions,events};
}
function analysisFingerprint(payload){return createHash('sha256').update(JSON.stringify(payload)).digest('hex');}
async function runDailyAnalysis(date){
  const payload=dailyAnalysisPayload(date),sourceFingerprint=analysisFingerprint(payload),result=await analyzeDailyActivity(settings,payload);
  return repository.saveDailyAnalysis(date,{sourceFingerprint,llmSummary:result.summary,llmInsights:result.insights,llmSuggestions:result.suggestions,modelPath:path.basename(settings.localLlm.modelPath||'')});
}

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/css/style.css", ["css/style.css", "text/css; charset=utf-8"]],
  ["/css/editor.css", ["css/editor.css", "text/css; charset=utf-8"]],
  ["/css/inline-editor.css", ["css/inline-editor.css", "text/css; charset=utf-8"]],
  ["/css/ai.css", ["css/ai.css", "text/css; charset=utf-8"]],
  ["/css/ticktocktome.css", ["css/ticktocktome.css", "text/css; charset=utf-8"]],
  ["/css/fonts.css", ["css/fonts.css", "text/css; charset=utf-8"]],
  ["/js/markup.js", ["js/markup.js", "text/javascript; charset=utf-8"]],
  ["/js/api-client.js", ["js/api-client.js", "text/javascript; charset=utf-8"]],
  ["/js/app.js", ["js/app.js", "text/javascript; charset=utf-8"]],
  ["/js/editor.js", ["js/editor.js", "text/javascript; charset=utf-8"]],
  ["/js/todo.js", ["js/todo.js", "text/javascript; charset=utf-8"]],
  ["/js/sidebar-timer.js", ["js/sidebar-timer.js", "text/javascript; charset=utf-8"]],
  ["/animations/navigation-power/styles.css", ["animations/navigation-power/styles.css", "text/css; charset=utf-8"]],
  ["/animations/navigation-power/geometry.js", ["animations/navigation-power/geometry.js", "text/javascript; charset=utf-8"]],
  ["/animations/navigation-power/screen-beans.js", ["animations/navigation-power/screen-beans.js", "text/javascript; charset=utf-8"]],
  ["/animations/navigation-power/controller.js", ["animations/navigation-power/controller.js", "text/javascript; charset=utf-8"]],
  ["/assets/help-timetable.svg", ["assets/help-timetable.svg", "image/svg+xml"]],
  ["/assets/help-calendar.svg", ["assets/help-calendar.svg", "image/svg+xml"]],
  ["/assets/help-file-roots.svg", ["assets/help-file-roots.svg", "image/svg+xml"]],
  ["/assets/help-storage.svg", ["assets/help-storage.svg", "image/svg+xml"]],
  ["/assets/help-daily-record.svg", ["assets/help-daily-record.svg", "image/svg+xml"]],
  ["/assets/help-worktree.svg", ["assets/help-worktree.svg", "image/svg+xml"]],
  ["/assets/help-files.svg", ["assets/help-files.svg", "image/svg+xml"]],
  ["/assets/help-library.svg", ["assets/help-library.svg", "image/svg+xml"]],
  ["/assets/help-todo.svg", ["assets/help-todo.svg", "image/svg+xml"]],
  ["/assets/help-timer.svg", ["assets/help-timer.svg", "image/svg+xml"]],
  ["/assets/fonts/NotoSansJP.ttf", ["assets/fonts/NotoSansJP.ttf", "font/ttf"]],
  ["/assets/fonts/RoundedMplus1c-Regular.ttf", ["assets/fonts/RoundedMplus1c-Regular.ttf", "font/ttf"]],
  ["/assets/fonts/ShipporiMincho-Regular.ttf", ["assets/fonts/ShipporiMincho-Regular.ttf", "font/ttf"]],
  ["/assets/fonts/Yomogi-Regular.ttf", ["assets/fonts/Yomogi-Regular.ttf", "font/ttf"]],
]);

function headers(type) {
  return {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
}

function sendJson(response, status, value) {
  response.writeHead(status, headers("application/json; charset=utf-8"));
  response.end(JSON.stringify(value));
}

async function readJsonBody(request, limit = 2 * 1024 * 1024) {
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) { const error = new Error("JSON形式の要求だけを受け付けます。"); error.statusCode = 415; throw error; }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) { const error = new Error("要求が大きすぎます。"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const error = new Error("JSON形式が正しくありません。"); error.statusCode = 400; throw error; }
}

function requireUiOrigin(request) {
  if (!allowedOrigins.has(String(request.headers.origin || ""))) { const error = new Error("許可されていない画面からの要求です。"); error.statusCode = 403; throw error; }
}

function openTarget(target) {
  if (process.platform === "darwin") return spawn("/usr/bin/open", ["--", target], { detached: true, stdio: "ignore", shell: false });
  if (process.platform === "win32") return spawn(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [target], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  return spawn("xdg-open", [target], { detached: true, stdio: "ignore", shell: false });
}

let activePicker = null;
function runPicker(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (activePicker) return reject(new Error("フォルダ選択画面はすでに開いています。画面手前またはDockを確認してください。"));
    const child = spawn(command, args, { ...options, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    activePicker = child;
    let output = "", errorOutput = "";
    let settled = false;
    const finish = (action, value) => { if (settled) return; settled = true; clearTimeout(timer); if (activePicker === child) activePicker = null; action(value); };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(reject, new Error("選択画面が応答しませんでした。もう一度お試しください。")); }, 120000);
    child.stdout.on("data", (chunk) => { if (output.length < 16384) output += chunk; });
    child.stderr.on("data", (chunk) => { if (errorOutput.length < 16384) errorOutput += chunk; });
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => code === 0 && output.trim() ? finish(resolve, output.trim()) : finish(reject, new Error(/cancel|キャンセル|-128/i.test(errorOutput) || code === 2 ? "選択をキャンセルしました。" : "選択画面を完了できませんでした。")));
  });
}

function runQuiet(command, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: "ignore" });
    let settled = false;
    const finish = (action, value) => { if (settled) return; settled = true; clearTimeout(timer); action(value); };
    const timer = setTimeout(() => { child.kill("SIGTERM"); finish(reject, new Error("サムネイル生成がタイムアウトしました。")); }, timeoutMs);
    child.once("error", (error) => finish(reject, error));
    child.once("close", (code) => code === 0 ? finish(resolve) : finish(reject, new Error("サムネイルを生成できませんでした。")));
  });
}

function paperSource(item) {
  if (item?.sourceRootId && item.sourceRelativePath) return resolveAllowedTarget(settings, item.sourceRootId, item.sourceRelativePath);
  if (item?.sourceUploadId) {
    const upload = repository.managedUploadById(item.sourceUploadId);
    if (upload?.mimeType === "application/pdf") return path.join(runtimePaths.uploadsDirectory, upload.storedName);
  }
  return null;
}

async function paperThumbnail(item) {
  const source = paperSource(item);
  if (!source || !statSync(source).isFile()) return null;
  const info = statSync(source), key = createHash("sha256").update(`${item.id}:${info.size}:${info.mtimeMs}`).digest("hex").slice(0, 20);
  const destination = path.join(thumbnailDirectory, `${key}.png`);
  if (existsSync(destination) && statSync(destination).size > 0) return destination;
  if (process.platform === "darwin") await runQuiet("/usr/bin/sips", ["-s", "format", "png", source, "--out", destination]);
  else return null;
  return existsSync(destination) && statSync(destination).size > 0 ? destination : null;
}

function paperPlaceholder(title = "PDF") {
  const safe = String(title).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]).slice(0, 42);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" fill="#fff"/><path d="M250 0l70 70h-70z" fill="#e8e5df"/><rect x="38" y="56" width="210" height="9" rx="4" fill="#555"/><rect x="38" y="84" width="244" height="5" rx="2" fill="#aaa"/><rect x="38" y="102" width="226" height="5" rx="2" fill="#bbb"/><rect x="38" y="142" width="244" height="3" fill="#ddd"/><rect x="38" y="164" width="244" height="3" fill="#ddd"/><rect x="38" y="186" width="220" height="3" fill="#ddd"/><text x="38" y="242" fill="#777" font-family="sans-serif" font-size="13">${safe || "PDF"}</text><text x="38" y="382" fill="#ba4c45" font-family="sans-serif" font-size="18" font-weight="700">PDF</text></svg>`;
}

async function pickRelativePath(rootId, kind) {
  if (!["file", "folder"].includes(kind)) throw new Error("選択種別が正しくありません。");
  const configured = settings.fileRoots.find((root) => root.id === rootId);
  if (!configured) throw new Error("基準フォルダが設定されていません。");
  const rootPath = await realpath(configured.absolutePath);
  let selected;
  if (process.platform === "darwin") {
    const action = kind === "file" ? "choose file" : "choose folder";
    const script = `on run argv\nset rootPath to item 1 of argv\ntell application "Finder"\nactivate\nset chosenItem to ${action} with prompt "基準フォルダ内から選択してください" default location (POSIX file rootPath)\nend tell\nreturn POSIX path of chosenItem\nend run`;
    selected = await runPicker("/usr/bin/osascript", ["-e", script, rootPath]);
  } else if (process.platform === "win32") {
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const script = kind === "file"
      ? "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.InitialDirectory=$env:TICKTOCKTOME_FILE_ROOT; $d.Multiselect=$false; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.FileName)}else{exit 2}"
      : "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.SelectedPath=$env:TICKTOCKTOME_FILE_ROOT; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}else{exit 2}";
    selected = await runPicker(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-Command", script], { env: { ...process.env, TICKTOCKTOME_FILE_ROOT: rootPath } });
  } else throw new Error("このOSの選択画面にはまだ対応していません。");
  const target = await realpath(selected.replace(/[\\/]$/, ""));
  if (target !== rootPath && !target.startsWith(`${rootPath}${path.sep}`)) throw new Error("基準フォルダ外は選択できません。");
  const relativePath = path.relative(rootPath, target).split(path.sep).join("/");
  if (!safeRelativePath(relativePath)) throw new Error("基準フォルダ自体は登録できません。");
  return relativePath;
}

async function pickRootFolder(promptText = "Tick Tock Tomeで参照する基準フォルダを選択してください") {
  let selected;
  if (process.platform === "darwin") {
    const script = `tell application "Finder"\nactivate\nset chosenItem to choose folder with prompt "${promptText.replace(/["\\]/g, "")}"\nend tell\nreturn POSIX path of chosenItem`;
    selected = await runPicker("/usr/bin/osascript", ["-e", script]);
  } else if (process.platform === "win32") {
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const safePrompt = promptText.replace(/[']/g, "");
    const script = `Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='${safePrompt}'; if($d.ShowDialog() -eq 'OK'){[Console]::Out.Write($d.SelectedPath)}else{exit 2}`;
    selected = await runPicker(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
  } else throw new Error("このOSのフォルダ選択画面にはまだ対応していません。");
  const absolutePath = await realpath(selected.replace(/[\\/]$/, ""));
  if (!statSync(absolutePath).isDirectory()) throw new Error("選択した場所はフォルダではありません。");
  return absolutePath;
}

async function chooseContentLocation(input) {
  if (Number(input?.revision) !== settings.revision) { const error = new Error("設定が別の画面で変更されました。再読み込みしてください。"); error.statusCode = 409; throw error; }
  const selected = await pickRootFolder("日記・時間割・資料などの共有データ保存先を選択してください");
  const target = existsSync(databasePathIn(selected)) ? selected : path.join(selected, "TickTockTomeData");
  if (path.resolve(target) === path.resolve(runtimePaths.contentDirectory)) return { contentLocation: target, revision: settings.revision, restartRequired: false };
  const targetPaths = pathsFor(machinePaths.dataDirectory, target);
  for (const directory of [targetPaths.databaseDirectory, targetPaths.backupDirectory, targetPaths.exportDirectory, targetPaths.quarantineDirectory, targetPaths.uploadsDirectory]) mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(targetPaths.databasePath)) {
    const verified = await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory, "before-storage-move");
    copyFileSync(verified, targetPaths.databasePath, 0);
    if (existsSync(runtimePaths.uploadsDirectory)) cpSync(runtimePaths.uploadsDirectory, targetPaths.uploadsDirectory, { recursive: true, force: false, errorOnExist: false });
  } else {
    const { DatabaseSync } = require("node:sqlite");
    const candidate = new DatabaseSync(targetPaths.databasePath, { readOnly: true });
    try { if (candidate.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("選択先のTick Tock Tomeデータベースが破損しています。"); } finally { candidate.close(); }
  }
  const saved = { schemaVersion: 1, revision: settings.revision + 1, port: settings.port, fileRoots: settings.fileRoots, theme: settings.theme, fontPreset: settings.fontPreset, localLlm: settings.localLlm, hiddenTagIds: settings.hiddenTagIds, contentDirectory: target };
  const { writeJsonAtomic } = require("./settings.js");
  writeJsonAtomic(machinePaths.settingPath, saved);
  settings.revision = saved.revision; settings.contentDirectory = target;
  return { contentLocation: target, revision: saved.revision, restartRequired: true };
}

function publicFileRoots() {
  return settings.fileRoots.map(({ id, displayName, absolutePath }) => {
    let available = false;
    try { available = statSync(realpathSync(absolutePath)).isDirectory(); } catch { /* 移動・削除・未接続 */ }
    return { id, displayName: displayName || id, absolutePath, available };
  });
}

function validTimestamp(value) {
  return typeof value === "string" && value.length <= 50 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function positiveRevision(value) {
  const revision = Number(value ?? 1);
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("sourceRevisionは1以上の整数にしてください。");
  return revision;
}

const allowedUploads = new Map([
  ["application/pdf", ".pdf"], ["image/jpeg", ".jpg"], ["image/png", ".png"],
  ["image/webp", ".webp"], ["image/gif", ".gif"], ["image/heic", ".heic"],
  ["text/plain", ".txt"], ["text/markdown", ".md"], ["text/csv", ".csv"],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["application/zip", ".zip"],
]);

async function saveManagedUpload(body) {
  const originalName = path.basename(String(body?.name || "")).slice(0, 300);
  let mimeType = String(body?.mimeType || "").toLowerCase();
  let extension = allowedUploads.get(mimeType);
  const safeByExtension = new Map([[".txt","text/plain"],[".md","text/markdown"],[".csv","text/csv"],[".pdf","application/pdf"],[".docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"],[".xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],[".pptx","application/vnd.openxmlformats-officedocument.presentationml.presentation"],[".zip","application/zip"]]);
  if (!extension && (!mimeType || mimeType === "application/octet-stream")) { extension = path.extname(originalName).toLowerCase(); mimeType = safeByExtension.get(extension) || ""; if (!mimeType) extension = ""; }
  if (!originalName || !extension || typeof body?.base64 !== "string") throw new Error("PDFまたは対応画像を選択してください。");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64) || body.base64.length % 4 !== 0) throw new Error("アップロードデータを読み取れません。");
  let bytes;
  try { bytes = Buffer.from(body.base64, "base64"); } catch { throw new Error("アップロードデータを読み取れません。"); }
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error("ファイルは25MB以下にしてください。");
  const id = `upload-${randomUUID()}`, storedName = `${randomUUID()}${extension}`, destination = path.join(runtimePaths.uploadsDirectory, storedName);
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  try { return repository.createManagedUpload({ id, storedName, originalName, mimeType, sizeBytes: bytes.length, createdAt: new Date().toISOString() }); }
  catch (error) { await unlink(destination).catch(() => {}); throw error; }
}

function validateTagFields(body, updating = false) {
  if (!body || typeof body.name !== "string" || !body.name.trim() || !/^[A-Za-z0-9_-]+$/.test(body.categoryId || "")) throw new Error("タグの分類・名前を確認してください。");
  const revision = Number(body.revision);
  if (updating && (!Number.isInteger(revision) || revision < 1)) throw new Error("更新情報が正しくありません。");
  return { name: body.name.trim().slice(0, 200), categoryId: body.categoryId, description: String(body.description || "").slice(0, 1000), displayOrder: Math.max(1, Number(body.displayOrder) || 1), ...(updating ? { revision } : {}) };
}

function validateCategoryFields(body, updating = false) {
  if (!body || typeof body.name !== "string" || !body.name.trim()) throw new Error("分類名を入力してください。");
  const revision = Number(body.revision);
  if (updating && (!Number.isInteger(revision) || revision < 1)) throw new Error("更新情報が正しくありません。");
  return { name: body.name.trim().slice(0, 200), description: String(body.description || "").slice(0, 1000), displayOrder: Math.max(1, Number(body.displayOrder) || 1), ...(updating ? { revision } : {}) };
}

function validateSource(body, client) {
  if (!body?.source || typeof body.source.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(body.source.id)) throw new Error("連携元IDが正しくありません。");
  if (body.source.id !== client.id) throw new Error("連携元IDが認証情報と一致しません。");
  return { id: body.source.id, name: String(body.source.name || body.source.id).slice(0, 200) };
}

function validateActivityEvents(body) {
  if (!Array.isArray(body.events) || body.events.length > 1000) throw new Error("作業履歴は1000件以下の配列にしてください。");
  return body.events.map((event) => {
    if (!event || typeof event.externalId !== "string" || !event.externalId || !validTimestamp(event.startedAt)) throw new Error("作業履歴の必須項目または開始日時が正しくありません。");
    if (event.endedAt && (!validTimestamp(event.endedAt) || Date.parse(event.endedAt) < Date.parse(event.startedAt))) throw new Error("作業履歴の終了日時が正しくありません。");
    if (event.sourceUpdatedAt && !validTimestamp(event.sourceUpdatedAt)) throw new Error("作業履歴の更新日時が正しくありません。");
    if (event.relativePath && !safeRelativePath(event.relativePath)) throw new Error("作業履歴のファイルパスが正しくありません。");
    return { externalId: event.externalId.slice(0, 300), startedAt: event.startedAt, endedAt: event.endedAt || null, applicationName: String(event.applicationName || "").slice(0, 300), windowTitle: String(event.windowTitle || "").slice(0, 2000), rootId: event.rootId || null, relativePath: event.relativePath || null, projectName: String(event.projectName || "").slice(0, 300), sourceRevision: positiveRevision(event.sourceRevision), sourceUpdatedAt: event.sourceUpdatedAt || null };
  });
}

function validateFileItems(body) {
  if (!Array.isArray(body.items) || body.items.length > 1000) throw new Error("ファイル索引は1000件以下の配列にしてください。");
  const roots = new Set(settings.fileRoots.map((root) => root.id));
  return body.items.map((item) => {
    if (!item || typeof item.externalId !== "string" || !item.externalId || !roots.has(item.rootId) || !safeRelativePath(item.relativePath)) throw new Error("ファイル索引の必須項目が正しくありません。");
    if (item.sizeBytes != null && (!Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0)) throw new Error("ファイルサイズが正しくありません。");
    if (item.modifiedAt && !validTimestamp(item.modifiedAt)) throw new Error("ファイル更新日時が正しくありません。");
    if (item.indexedAt && !validTimestamp(item.indexedAt)) throw new Error("索引日時が正しくありません。");
    return { externalId: item.externalId.slice(0, 300), rootId: item.rootId, relativePath: item.relativePath.replace(/\\/g, "/"), name: String(item.name || path.basename(item.relativePath)).slice(0, 500), extension: String(item.extension || path.extname(item.relativePath)).slice(0, 30), sizeBytes: item.sizeBytes ?? null, modifiedAt: item.modifiedAt || null, indexedAt: item.indexedAt || null, sourceRevision: positiveRevision(item.sourceRevision), missing: Boolean(item.missing) };
  });
}

async function handle(request, response) {
  if (![`${host}:${port}`, `localhost:${port}`].includes(String(request.headers.host || ""))) return sendJson(response, 403, { error: "許可されていないHostです。" });
  const url = new URL(request.url || "/", `http://${request.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === "GET" && pathname === "/health") return sendJson(response, 200, { ok: true, revision });
  if (request.method === "GET" && staticFiles.has(pathname)) {
    const [relative, type] = staticFiles.get(pathname);
    try { response.writeHead(200, headers(type)); response.end(await readFile(path.join(projectRoot, relative))); }
    catch { sendJson(response, 404, { error: "ファイルが見つかりません。" }); }
    return;
  }
  if (request.method === "GET" && pathname === "/api/v1/bootstrap") return sendJson(response, 200, { dashboard: repository.dashboard(), tagCategories: repository.listTagCategories(), tags: repository.listTags(), archivedTags: repository.listTags(true).filter(tag=>tag.archivedAt), authorSuggestions: repository.listLibraryAuthors(), fileRoots: publicFileRoots(), theme: settings.theme, fontPreset: settings.fontPreset, localLlm: settings.localLlm, hiddenTagIds: settings.hiddenTagIds, contentLocation: settings.contentDirectory, settingsRevision: settings.revision, platform: process.platform, memoApp: { installed: Boolean(memoCompanion()), name: "PopNote!" } });
  if (request.method === "GET" && pathname === "/api/v1/journals") return sendJson(response, 200, { items: repository.listJournals({ query: url.searchParams.get("q") || "", tagId: url.searchParams.get("tag") || "", limit: Number(url.searchParams.get("limit")) || 100, offset: Number(url.searchParams.get("offset")) || 0 }) });
  if (request.method === "GET" && pathname.startsWith("/api/v1/journals/by-date/")) return sendJson(response, 200, { item: repository.journalByDate(pathname.slice(25)) });
  if (request.method === "GET" && /^\/api\/v1\/journals\/[^/]+$/.test(pathname)) return sendJson(response, 200, { item: repository.journalById(pathname.split("/").at(-1)) });
  if (request.method === "POST" && pathname === "/api/v1/journals") { requireUiOrigin(request); const item = repository.createJournal(journals.validate(await readJsonBody(request))); return sendJson(response, 201, { item }); }
  if (request.method === "POST" && pathname === "/api/v1/tags") {
    requireUiOrigin(request); const body = await readJsonBody(request);
    if (!/^[A-Za-z0-9_-]+$/.test(body?.id || "")) throw new Error("タグの内部IDを確認してください。");
    return sendJson(response, 201, { item: repository.createTag({ id: body.id, ...validateTagFields(body) }) });
  }
  if (request.method === "PUT" && /^\/api\/v1\/tags\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); return sendJson(response, 200, { item: repository.updateTag(id, validateTagFields(await readJsonBody(request), true)) }); }
  if (request.method === "POST" && /^\/api\/v1\/tags\/[^/]+\/(archive|restore)$/.test(pathname)) { requireUiOrigin(request); const parts=pathname.split("/"),body=await readJsonBody(request); return sendJson(response,200,{item:repository.setTagArchived(parts[4],parts[5]==="archive",body.revision)}); }
  if (request.method === "POST" && pathname === "/api/v1/tag-categories") { requireUiOrigin(request); const body = await readJsonBody(request); if (!/^[A-Za-z0-9_-]+$/.test(body?.id || "")) throw new Error("分類の内部IDを確認してください。"); return sendJson(response, 201, { item: repository.createTagCategory({ id: body.id, ...validateCategoryFields(body) }) }); }
  if (request.method === "PUT" && /^\/api\/v1\/tag-categories\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); return sendJson(response, 200, { item: repository.updateTagCategory(id, validateCategoryFields(await readJsonBody(request), true)) }); }
  if (request.method === "POST" && pathname === "/api/v1/uploads") { requireUiOrigin(request); return sendJson(response, 201, { item: await saveManagedUpload(await readJsonBody(request, 35 * 1024 * 1024)) }); }
  if (request.method === "GET" && /^\/api\/v1\/uploads\/[^/]+\/content$/.test(pathname)) {
    const item = repository.managedUploadById(pathname.split("/")[4]);
    if (!item) return sendJson(response, 404, { error: "ファイルが見つかりません。" });
    response.writeHead(200, { ...headers(item.mimeType), ...(item.mimeType === "application/pdf" ? { "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" } : {}), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(item.originalName)}` });
    response.end(await readFile(path.join(runtimePaths.uploadsDirectory, item.storedName))); return;
  }
  if (request.method === "GET" && pathname === "/api/v1/files") return sendJson(response, 200, { items: repository.listFiles(Number(url.searchParams.get("limit")) || 500, Number(url.searchParams.get("offset")) || 0), total: repository.fileCount() });
  if (request.method === "POST" && pathname === "/api/v1/files:reference") { requireUiOrigin(request); const body=await readJsonBody(request); if(body.rootId!=="files")throw new Error("ファイル用の基準パスを使用してください。"); const target=resolveAllowedTarget(settings,body.rootId,body.relativePath); if(!statSync(target).isFile())throw new Error("ファイルを選択してください。"); return sendJson(response,201,{item:repository.createManagedFile(body.rootId,body.relativePath)}); }
  if (request.method === "GET" && /^\/api\/v1\/files\/[^/]+$/.test(pathname)) return sendJson(response, 200, { item: repository.fileById(pathname.split("/").at(-1)) });
  if (request.method === "PUT" && /^\/api\/v1\/files\/[^/]+\/tags$/.test(pathname)) {
    requireUiOrigin(request); const id = pathname.split("/")[4]; const body = await readJsonBody(request);
    const tagIds = [...new Set(Array.isArray(body.tagIds) ? body.tagIds.map(String) : [])];
    if (tagIds.some((tagId) => !/^[A-Za-z0-9_-]+$/.test(tagId))) throw new Error("タグの指定が正しくありません。");
    const revision = Number(body.metadataRevision);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("更新情報が正しくありません。");
    return sendJson(response, 200, { item: repository.updateFileTags(id, tagIds, revision) });
  }
  if (request.method === "GET" && pathname === "/api/v1/library") {
    const itemType = url.searchParams.get("type") || "";
    if (!["book", "textbook", "paper"].includes(itemType)) throw new Error("資料種別が正しくありません。");
    return sendJson(response, 200, { items: repository.listLibraryItems(itemType) });
  }
  if (request.method === "GET" && pathname === "/api/v1/todos") return sendJson(response,200,{items:repository.listTodos()});
  if (request.method === 'GET' && pathname === '/api/v1/timer') return sendJson(response,200,{...timerState(repository,new Date(),settings.hiddenTagIds),windowOn:Boolean(timerWindowProcess)});
  if (request.method === 'GET' && pathname === '/api/v1/timer/overdue') return sendJson(response,200,{items:repository.listOverdueActions(new Date())});
  if (request.method === 'POST' && pathname === '/api/v1/timer:start') {requireUiOrigin(request);return sendJson(response,201,{item:startAction(repository,await readJsonBody(request))});}
  if (request.method === 'POST' && pathname === '/api/v1/timer:complete') {
    requireUiOrigin(request);const body=await readJsonBody(request);
    return sendJson(response,200,{item:repository.resolveDailyAction(body.id,{
      outcome:String(body.outcome||'completed'),progress:Number(body.progress),
      actualStartTime:String(body.actualStartTime||''),actualEndTime:String(body.actualEndTime||''),
      continueAsTodo:Boolean(body.continueAsTodo),dueDate:String(body.dueDate||""),
      note:String(body.note||"").trim().slice(0,2000)
    },body.revision)});
  }
  if (request.method === 'GET' && /^\/api\/v1\/daily-analysis\/\d{4}-\d{2}-\d{2}$/.test(pathname)) {
    const date=pathname.split('/').at(-1);if(!validDate(date))throw new Error('対象日を確認してください。');
    const item=repository.dailyAnalysis(date),fingerprint=analysisFingerprint(dailyAnalysisPayload(date));
    return sendJson(response,200,{item:item?{...item,stale:item.sourceFingerprint!==fingerprint}:null});
  }
  if (request.method === 'POST' && /^\/api\/v1\/daily-analysis\/\d{4}-\d{2}-\d{2}:run$/.test(pathname)) {
    requireUiOrigin(request);const date=pathname.split('/').at(-1).replace(':run','');if(!validDate(date))throw new Error('対象日を確認してください。');
    return sendJson(response,200,{item:await runDailyAnalysis(date)});
  }
  if (request.method === 'POST' && pathname === '/api/v1/daily-analysis:auto') {
    requireUiOrigin(request);if(!settings.localLlm?.enabled||settings.localLlm.analysisMode!=='auto')return sendJson(response,200,{items:[]});
    const now=new Date(),items=[];
    for(let offset=1;offset<=7;offset+=1){const day=new Date(now);day.setDate(day.getDate()-offset);const date=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`,payload=dailyAnalysisPayload(date),fingerprint=analysisFingerprint(payload),old=repository.dailyAnalysis(date);if(!old||old.sourceFingerprint!==fingerprint)items.push(await runDailyAnalysis(date));}
    return sendJson(response,200,{items});
  }
  if (request.method === 'POST' && pathname === '/api/v1/timer-window') {
    requireUiOrigin(request);const body=await readJsonBody(request);
    if(typeof body.on!=='boolean')throw new Error('ON/OFFを指定してください。');
    if(!body.on){timerWindowProcess?.kill('SIGTERM');timerWindowProcess=null;}
    else if(!timerWindowProcess){
      if(!['darwin','win32'].includes(process.platform))throw new Error('常駐タイマーはmacOSとWindowsに対応しています。');
      const child=spawn(process.execPath,[path.join(projectRoot,'scripts/timer-window.js'),String(port),runtimePaths.runtimeDirectory],{stdio:['ignore','ignore','ignore'],shell:false,windowsHide:true});
      timerWindowProcess=child;child.once('exit',()=>{if(timerWindowProcess===child)timerWindowProcess=null;});child.once('error',()=>{if(timerWindowProcess===child)timerWindowProcess=null;});
    }
    return sendJson(response,200,{on:Boolean(timerWindowProcess)});
  }
  if (request.method === "POST" && /^\/api\/v1\/memo-trash\/[^/]+\/restore$/.test(pathname)) { requireUiOrigin(request); const body = await readJsonBody(request); return sendJson(response, 200, { item: repository.restoreMemo(pathname.split("/")[4], Number(body.revision)) }); }
  if (request.method === "DELETE" && /^\/api\/v1\/memo-trash\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const body = await readJsonBody(request); await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory, "before-memo-purge"); repository.purgeMemo(pathname.split("/").at(-1), Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "POST" && pathname === "/api/v1/memo-window") {
    requireUiOrigin(request); const body = await readJsonBody(request);
    const memoId = body?.memoId == null || body.memoId === "" ? "" : String(body.memoId);
    if (memoId && !/^memo-[0-9a-f-]{36}$/.test(memoId)) throw new Error("メモの指定が正しくありません。");
    const companion = memoCompanion();
    if (!companion) { const error = new Error("メモを開くには、連携アプリPopNote!（macOS）をインストールしてください。"); error.statusCode = 404; throw error; }
    const opened = await new Promise((resolve) => { const child = spawn("/usr/bin/open", [`${companion.urlScheme}://${memoId ? `open/${memoId}` : "new"}`], { stdio: "ignore", shell: false }); child.once("error", () => resolve(false)); child.once("exit", (code) => resolve(code === 0)); });
    if (!opened) { const error = new Error("PopNote!が見つかりません。アプリを移動・削除した場合は、PopNote!を一度起動し直してください。"); error.statusCode = 404; throw error; }
    return sendJson(response, 200, { ok: true });
  }
  if (request.method === "POST" && pathname === "/api/v1/todos") { requireUiOrigin(request); return sendJson(response,201,{item:repository.saveTodo(await readJsonBody(request))}); }
  if (request.method === "PUT" && /^\/api\/v1\/todos\/[^/]+$/.test(pathname)) { requireUiOrigin(request); return sendJson(response,200,{item:repository.saveTodo(await readJsonBody(request),pathname.split('/').at(-1))}); }
  if (request.method === "DELETE" && /^\/api\/v1\/todos\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const body=await readJsonBody(request); repository.deleteTodo(pathname.split('/').at(-1),body.revision); return sendJson(response,200,{ok:true}); }
  if (request.method === "POST" && pathname === "/api/v1/library:reference-pdf") {
    requireUiOrigin(request); const body=await readJsonBody(request);
    if (!["book","textbook","paper"].includes(body.itemType) || !/\.pdf$/i.test(body.relativePath || "")) throw new Error("PDFを選択してください。");
    if(body.rootId!==({book:"books",textbook:"textbooks",paper:"papers"}[body.itemType]))throw new Error("資料種別に対応する基準パスを使用してください。");
    const target=resolveAllowedTarget(settings,body.rootId,body.relativePath);
    if (!statSync(target).isFile()) throw new Error("PDFファイルを選択してください。");
    return sendJson(response,201,{item:repository.createReferencedLibraryItem(body.itemType,body.rootId,body.relativePath)});
  }
  if (request.method === "POST" && pathname === "/api/v1/library:extract-metadata") { requireUiOrigin(request); const body=await readJsonBody(request); if(!["book","textbook","paper"].includes(body.itemType))throw new Error("資料種別が正しくありません。"); const expected={book:"books",textbook:"textbooks",paper:"papers"}[body.itemType];if(body.rootId!==expected)throw new Error("資料種別に対応する基準パスを使用してください。");const target=resolveAllowedTarget(settings,body.rootId,body.relativePath);if(!statSync(target).isFile())throw new Error("PDFを選択してください。");return sendJson(response,200,{metadata:await extractLibraryMetadata(settings,target,body.itemType)});}
  if (request.method === "GET" && /^\/api\/v1\/library\/[^/]+\/pdf$/.test(pathname)) {
    const item=repository.libraryItemById(pathname.split('/')[4]);
    if (!item?.sourceRootId || !/\.pdf$/i.test(item.sourceRelativePath || "")) return sendJson(response,404,{error:"PDF参照がありません。"});
    const target=resolveAllowedTarget(settings,item.sourceRootId,item.sourceRelativePath);
    response.writeHead(200,{...headers("application/pdf"),"X-Frame-Options":"SAMEORIGIN","Content-Security-Policy":"default-src 'none'; frame-ancestors 'self'"});
    response.end(await readFile(target)); return;
  }
  if (request.method === "GET" && /^\/api\/v1\/library\/[^/]+\/thumbnail$/.test(pathname)) {
    const item=repository.libraryItemById(pathname.split('/')[4]);
    if (!item || item.itemType !== "paper") return sendJson(response,404,{error:"論文が見つかりません。"});
    let thumbnail=null;
    try { thumbnail=await paperThumbnail(item); } catch { /* 生成できない環境では軽量な書類画像を返す */ }
    if (thumbnail) { response.writeHead(200,headers("image/png")); response.end(await readFile(thumbnail)); return; }
    response.writeHead(200,headers("image/svg+xml; charset=utf-8")); response.end(paperPlaceholder(item.title)); return;
  }
  if (request.method === "GET" && /^\/api\/v1\/library\/[^/]+$/.test(pathname)) return sendJson(response, 200, { item: repository.libraryItemById(pathname.split("/").at(-1)) });
  if (request.method === "POST" && pathname === "/api/v1/library") { requireUiOrigin(request); return sendJson(response, 201, { item: repository.createLibraryItem(validateLibraryReference(await readJsonBody(request))) }); }
  if (request.method === "POST" && pathname === "/api/v1/library:upload-pdf") { requireUiOrigin(request); const body = await readJsonBody(request); if (!['book','textbook','paper'].includes(body?.itemType)) throw new Error("資料種別が正しくありません。"); const upload = repository.managedUploadById(body.uploadId); if (!upload || upload.mimeType !== 'application/pdf') throw new Error("PDFを確認できません。"); return sendJson(response, 201, { item: repository.createUploadedLibraryItem(body.itemType, upload.id, upload.originalName) }); }
  if (request.method === "PUT" && /^\/api\/v1\/library\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); return sendJson(response, 200, { item: repository.updateLibraryItem(id, validateLibraryReference(await readJsonBody(request), true)) }); }
  if (request.method === "DELETE" && /^\/api\/v1\/library\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const body = await readJsonBody(request); repository.deleteLibraryItem(id, Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "PUT" && /^\/api\/v1\/journals\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const item = repository.updateJournal(id, journals.validate(await readJsonBody(request), true)); return sendJson(response, 200, { item }); }
  if (request.method === "DELETE" && /^\/api\/v1\/journals\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const body = await readJsonBody(request); repository.deleteJournal(id, Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "GET" && pathname === "/api/v1/daily-actions") {
    const date = url.searchParams.get("date") || "", from = url.searchParams.get("from") || "", to = url.searchParams.get("to") || "";
    if ((date && !validDate(date)) || (from && !validDate(from)) || (to && !validDate(to))) throw new Error("対象日はYYYY-MM-DD形式にしてください。");
    return sendJson(response, 200, { items: repository.listDailyActions({ date, from, to, limit: Number(url.searchParams.get("limit")) || 500 }) });
  }
  if (request.method === "POST" && pathname === "/api/v1/daily-actions") { requireUiOrigin(request); return sendJson(response, 201, { item: repository.createDailyAction(validateDailyAction(await readJsonBody(request))) }); }
  if (request.method === "PUT" && /^\/api\/v1\/daily-actions\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); return sendJson(response, 200, { item: repository.updateDailyAction(id, validateDailyAction(await readJsonBody(request), true)) }); }
  if (request.method === "DELETE" && /^\/api\/v1\/daily-actions\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const body = await readJsonBody(request); repository.deleteDailyAction(id, Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "GET" && pathname === "/api/v1/timeline") return sendJson(response, 200, { items: repository.timeline(Number(url.searchParams.get("limit")) || 150) });
  if (request.method === "GET" && pathname === "/api/v1/calendar") {
    const month = url.searchParams.get("month") || "";
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("対象月はYYYY-MM形式にしてください。");
    return sendJson(response, 200, { items: repository.calendarMonth(month) });
  }
  if (request.method === "GET" && pathname === "/api/v1/work-tree") return sendJson(response, 200, { items: repository.workTree() });
  if (request.method === "GET" && pathname === "/api/v1/search") return sendJson(response, 200, repository.search(url.searchParams.get("q") || ""));
  if (request.method === "GET" && pathname === "/api/v1/trash") return sendJson(response, 200, { items: repository.listTrash() });
  if (request.method === "POST" && /^\/api\/v1\/trash\/[^/]+\/restore$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/")[4]; const body = await readJsonBody(request); return sendJson(response, 200, { item: repository.restoreJournal(id, Number(body.revision)) }); }
  if (request.method === "DELETE" && /^\/api\/v1\/trash\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const body = await readJsonBody(request); await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory, "before-purge"); repository.purgeJournal(id, Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "POST" && /^\/api\/v1\/library-trash\/[^/]+\/restore$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/")[4]; const body = await readJsonBody(request); return sendJson(response, 200, { item: repository.restoreLibraryItem(id, Number(body.revision)) }); }
  if (request.method === "DELETE" && /^\/api\/v1\/library-trash\/[^/]+$/.test(pathname)) { requireUiOrigin(request); const id = pathname.split("/").at(-1); const body = await readJsonBody(request); await createVerifiedBackup(runtimePaths.databasePath, runtimePaths.backupDirectory, "before-library-purge"); repository.purgeLibraryItem(id, Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "POST" && pathname === "/api/v1/open-path") { requireUiOrigin(request); const body = await readJsonBody(request); const target = resolveAllowedTarget(settings, body.rootId, body.relativePath); openTarget(target).unref(); return sendJson(response, 200, { ok: true }); }
  if (request.method === "POST" && pathname === "/api/v1/pick-path") { requireUiOrigin(request); const body = await readJsonBody(request); return sendJson(response, 200, { relativePath: await pickRelativePath(body.rootId, body.kind) }); }
  if (request.method === "POST" && pathname === "/api/v1/settings/file-roots:choose") {
    requireUiOrigin(request);
    const body = await readJsonBody(request);
    validateRootInput(body);
    const absolutePath = await pickRootFolder();
    return sendJson(response, 200, { item: upsertFileRoot(settings, runtimePaths.settingPath, body, absolutePath) });
  }
  if (request.method === "PUT" && pathname === "/api/v1/settings/theme") { requireUiOrigin(request); return sendJson(response, 200, updateTheme(settings, runtimePaths.settingPath, await readJsonBody(request))); }
  if (request.method === "PUT" && pathname === "/api/v1/settings/font") { requireUiOrigin(request); return sendJson(response, 200, updateFontPreset(settings, runtimePaths.settingPath, await readJsonBody(request))); }
  if (request.method === "PUT" && pathname === "/api/v1/settings/local-llm") { requireUiOrigin(request); return sendJson(response, 200, updateLocalLlm(settings, runtimePaths.settingPath, await readJsonBody(request))); }
  if (request.method === "PUT" && pathname === "/api/v1/settings/tag-visibility") { requireUiOrigin(request); return sendJson(response, 200, updateTagVisibility(settings, runtimePaths.settingPath, await readJsonBody(request))); }
  if (request.method === "POST" && pathname === "/api/v1/settings/content-location:choose") { requireUiOrigin(request); return sendJson(response, 200, await chooseContentLocation(await readJsonBody(request))); }
  if (request.method === "POST" && pathname === "/api/v1/integrations/activity-events:batch") { const client = authorizeIntegration(request, runtimePaths.integrationsPath, "activity:write"); if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" }); const body = await readJsonBody(request); return sendJson(response, 200, repository.upsertActivityBatch(validateSource(body, client), validateActivityEvents(body))); }
  if (request.method === "POST" && pathname === "/api/v1/integrations/file-index:batch") { const client = authorizeIntegration(request, runtimePaths.integrationsPath, "files:write"); if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" }); const body = await readJsonBody(request); return sendJson(response, 200, repository.upsertFileIndexBatch(validateSource(body, client), validateFileItems(body))); }
  if (request.method === "GET" && pathname === "/api/v1/integrations/command/search") { const client = authorizeIntegration(request, runtimePaths.integrationsPath, "search:read"); if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" }); return sendJson(response, 200, repository.search(url.searchParams.get("q") || "")); }
  if (request.method === "GET" && pathname.startsWith("/api/v1/integrations/command/journals/by-date/")) { const client = authorizeIntegration(request, runtimePaths.integrationsPath, "journal:read"); if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" }); return sendJson(response, 200, { item: repository.journalByDate(pathname.slice("/api/v1/integrations/command/journals/by-date/".length)) }); }
  if (request.method === "POST" && pathname === "/api/v1/integrations/command/journals") {
    const client = authorizeIntegration(request, runtimePaths.integrationsPath, "journal:write"); if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" });
    const input = journals.validate(await readJsonBody(request));
    const existing = repository.journalByDate(input.entryDate);
    return sendJson(response, existing ? 200 : 201, { item: existing || repository.createJournal(input), alreadyExisted: Boolean(existing) });
  }
  if (pathname.startsWith("/api/v1/integrations/memo/")) return handleMemoIntegration(request, response, url, pathname.slice("/api/v1/integrations/memo/".length));
  return sendJson(response, 404, { error: "Not Found" });
}

// PopNote!向けのメモAPI。画面用APIと分け、アプリ別トークンのmemo:read / memo:write権限で保護する。
async function handleMemoIntegration(request, response, url, route) {
  const client = authorizeIntegration(request, runtimePaths.integrationsPath, request.method === "GET" ? "memo:read" : "memo:write");
  if (!client) return sendJson(response, 401, { error: "連携認証に失敗しました。" });
  const memoPath = /^memos\/(memo-[0-9a-f-]{36})$/.exec(route);
  if (request.method === "GET" && route === "context") return sendJson(response, 200, { tagCategories: repository.listTagCategories(), tags: repository.listTags(), fileRoots: publicFileRoots().map(({ id, displayName, available }) => ({ id, displayName, available })) });
  if (request.method === "GET" && route === "memos") return sendJson(response, 200, { items: repository.listMemos({ query: url.searchParams.get("q") || "", limit: Number(url.searchParams.get("limit")) || 200 }) });
  if (request.method === "GET" && memoPath) { const item = repository.memoById(memoPath[1]); return item ? sendJson(response, 200, { item }) : sendJson(response, 404, { error: "メモが見つかりません。" }); }
  if (request.method === "POST" && route === "memos") return sendJson(response, 201, { item: repository.createMemo(validateMemo(await readJsonBody(request))) });
  if (request.method === "PUT" && memoPath) return sendJson(response, 200, { item: repository.updateMemo(memoPath[1], validateMemo(await readJsonBody(request), true)) });
  if (request.method === "DELETE" && memoPath) { const body = await readJsonBody(request); repository.deleteMemo(memoPath[1], Number(body.revision)); return sendJson(response, 200, { ok: true }); }
  if (request.method === "POST" && route === "tags") { const body = await readJsonBody(request); return sendJson(response, 201, { item: repository.findOrCreateTagByName(body?.name) }); }
  if (request.method === "POST" && route === "uploads") {
    const body = await readJsonBody(request, 35 * 1024 * 1024);
    if (!String(body?.mimeType || "").startsWith("image/")) throw new Error("メモへ貼り付けられるのは画像だけです。");
    return sendJson(response, 201, { item: await saveManagedUpload(body) });
  }
  if (request.method === "POST" && route === "files:pick") {
    const relativePath = await pickRelativePath("files", "file");
    if (!statSync(resolveAllowedTarget(settings, "files", relativePath)).isFile()) throw new Error("ファイルを選択してください。");
    return sendJson(response, 201, { item: repository.createManagedFile("files", relativePath) });
  }
  const openFile = /^files\/(managed-file-[0-9a-f-]{36}):open$/.exec(route);
  if (request.method === "POST" && openFile) {
    const file = repository.fileById(openFile[1]);
    if (!file) return sendJson(response, 404, { error: "ファイルが見つかりません。" });
    openTarget(resolveAllowedTarget(settings, file.rootId, file.relativePath)).unref();
    return sendJson(response, 200, { ok: true });
  }
  return sendJson(response, 404, { error: "Not Found" });
}

const server = createServer((request, response) => handle(request, response).catch((error) => {
  const status = error.statusCode || (/UNIQUE constraint failed/.test(error.message) ? 409 : /FOREIGN KEY constraint failed/.test(error.message) ? 400 : 400);
  sendJson(response, status, { error: error instanceof Error ? error.message : "処理に失敗しました。" });
}));

server.listen(port, host, () => console.log(`Tick Tock Tome: http://localhost:${port}/`));
function shutdown() { timerWindowProcess?.kill('SIGTERM'); server.close(() => { database.close(); process.exit(0); }); }
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
