"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createDataset } = require("../../scripts/dataset.js");

const projectRoot = path.resolve(__dirname, "../..");

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`テストサーバーが終了しました: ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch { /* 起動中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("テストサーバーの起動待ちが時間切れになりました。");
}

test("画面用APIと認証付き連携APIの境界を守る", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-http-"));
  const port = await reservePort();
  const configDirectory = path.join(directory, "config");
  fs.mkdirSync(configDirectory, { recursive: true });
  const basePath = path.join(directory, "base");
  fs.mkdirSync(basePath);
  createDataset(basePath, { datasetId: "テスト" });
  fs.writeFileSync(path.join(configDirectory, "setting.json"), JSON.stringify({ schemaVersion: 2, port, machineId: "test-machine-0001", basePath: fs.realpathSync(basePath) }));
  fs.writeFileSync(path.join(configDirectory, "integrations.json"), JSON.stringify({ schemaVersion: 1, clients: [{ id: "command-test", name: "Command Test", token: "test-token-not-for-production", permissions: ["journal:read", "journal:write", "search:read"] }, { id: "activity-test", name: "Activity Test", token: "activity-token-not-for-production", permissions: ["activity:write"] }] }));
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/server.js")], {
    cwd: projectRoot,
    env: { ...process.env, TICKTOCKTOME_DATA_DIR: directory },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(base, child);
    const forbidden = await fetch(`${base}/api/v1/journals`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://example.invalid" }, body: "{}" });
    assert.equal(forbidden.status, 403);
    const created = await fetch(`${base}/api/v1/journals`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ entryDate: "2026-09-11", title: "HTTP API test", bodyMarkdown: "local only", tagIds: [], projectIds: [], files: [] }) });
    assert.equal(created.status, 201);
    const unauthenticated = await fetch(`${base}/api/v1/integrations/command/search?q=local`);
    assert.equal(unauthenticated.status, 401);
    const authenticated = await fetch(`${base}/api/v1/integrations/command/search?q=local`, { headers: { Authorization: "Bearer test-token-not-for-production" } });
    assert.equal(authenticated.status, 200);
    assert.equal((await authenticated.json()).journals.length, 1);
    const impersonated = await fetch(`${base}/api/v1/integrations/activity-events:batch`, { method: "POST", headers: { Authorization: "Bearer activity-token-not-for-production", "Content-Type": "application/json" }, body: JSON.stringify({ source: { id: "someone-else" }, events: [] }) });
    assert.equal(impersonated.status, 400);
    const activity = await fetch(`${base}/api/v1/integrations/activity-events:batch`, { method: "POST", headers: { Authorization: "Bearer activity-token-not-for-production", "Content-Type": "application/json" }, body: JSON.stringify({ source: { id: "activity-test", name: "Activity Test" }, events: [{ externalId: "event-1", startedAt: "2026-09-11T10:00:00+09:00", endedAt: "2026-09-11T10:30:00+09:00", sourceRevision: 1 }] }) });
    assert.equal(activity.status, 200);
    assert.equal((await activity.json()).accepted, 1);
    const uploaded = await fetch(`${base}/api/v1/uploads`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "sample.pdf", mimeType: "application/pdf", base64: Buffer.from("%PDF-1.4\ntest").toString("base64") }) });
    assert.equal(uploaded.status, 201);
    const uploadItem = (await uploaded.json()).item;
    assert.equal(fs.existsSync(path.join(basePath, ".kobito-tools", "Tomelet", "uploads", uploadItem.storedName)), true);
    const intake = await fetch(`${base}/api/v1/library:upload-pdf`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ itemType: "book", uploadId: uploadItem.id }) });
    assert.equal(intake.status, 201);
    assert.equal((await intake.json()).item.intakeStatus, "uploaded");
    const paperIntake = await fetch(`${base}/api/v1/library:upload-pdf`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ itemType: "paper", uploadId: uploadItem.id }) });
    assert.equal(paperIntake.status, 201);
    assert.equal((await paperIntake.json()).item.itemType, "paper");
    const rejected = await fetch(`${base}/api/v1/uploads`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "bad.exe", mimeType: "application/octet-stream", base64: "AA==" }) });
    assert.equal(rejected.status, 400);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
