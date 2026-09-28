"use strict";

const { createHash } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { ensurePrivateDirectories, loadSettings, pathsFor } = require("./settings.js");

const projectRoot = path.resolve(__dirname, "..");
const runtimePaths = pathsFor();
ensurePrivateDirectories(runtimePaths);
const settings = loadSettings(runtimePaths);
const pageUrl = `http://localhost:${settings.port}/`;
const healthUrl = `${pageUrl}health`;
const serverPath = path.join(projectRoot, "scripts", "server.js");
const expectedRevision = createHash("sha256").update(readFileSync(serverPath)).digest("hex").slice(0, 16);
const openBrowserOnReady = !process.argv.includes("--no-browser");

function openBrowser() {
  if (process.platform === "darwin") return spawn("/usr/bin/open", [pageUrl], { detached: true, stdio: "ignore", shell: false }).unref();
  if (process.platform === "win32") return spawn(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [pageUrl], { detached: true, stdio: "ignore", windowsHide: true, shell: false }).unref();
  return spawn("xdg-open", [pageUrl], { detached: true, stdio: "ignore", shell: false }).unref();
}

async function serverState() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return "outdated";
    return (await response.json()).revision === expectedRevision ? "current" : "outdated";
  } catch { return "absent"; }
}

async function stopOutdatedServer() {
  if (!existsSync(runtimePaths.pidPath)) throw new Error("別のTomeletサーバーが動作中です。終了してから開き直してください。");
  const { pid } = JSON.parse(readFileSync(runtimePaths.pidPath, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("終了情報が正しくありません。");
  if (process.platform === "win32") spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
  else { try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); } }
  rmSync(runtimePaths.pidPath, { force: true });
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await serverState() === "current") return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

(async () => {
  const state = await serverState();
  if (state === "current") { if (openBrowserOnReady) openBrowser(); return; }
  if (state === "outdated") await stopOutdatedServer();
  const log = openSync(runtimePaths.runtimeLogPath, "a", 0o600);
  const server = spawn(process.execPath, [serverPath], { cwd: projectRoot, detached: true, stdio: ["ignore", log, log], windowsHide: true, shell: false });
  server.unref();
  closeSync(log);
  writeFileSync(runtimePaths.pidPath, `${JSON.stringify({ pid: server.pid, startedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  if (await waitUntilReady()) { if (openBrowserOnReady) openBrowser(); return; }
  console.error(`Tomeletを起動できませんでした。診断ログ: ${runtimePaths.runtimeLogPath}`);
  process.exitCode = 1;
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
