"use strict";

const { spawnSync } = require("node:child_process");
const { existsSync, readFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { pathsFor } = require("./settings.js");

const runtimePaths = pathsFor();
if (!existsSync(runtimePaths.pidPath)) {
  console.log("Tick Tock Tomeはランチャーから起動されていません。");
  process.exit(0);
}
try {
  const { pid } = JSON.parse(readFileSync(runtimePaths.pidPath, "utf8"));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("PIDが正しくありません。");
  if (process.platform === "win32") spawnSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, shell: false });
  else { try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); } }
  console.log("Tick Tock Tomeを終了しました。");
} catch { console.log("既に終了しているか、終了情報を利用できません。"); }
finally { rmSync(runtimePaths.pidPath, { force: true }); }
