"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { createDataset } = require("../../scripts/dataset.js");
const { registerCompanion } = require("../../scripts/integrations/companions.js");

const projectRoot = path.resolve(__dirname, "../..");

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close((error) => error ? reject(error) : resolve(port)); });
  });
}

test("PopNote!向けメモAPIは専用トークンの権限だけで読み書きできる", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-memo-http-"));
  const port = await reservePort();
  const configDirectory = path.join(directory, "config");
  fs.mkdirSync(configDirectory, { recursive: true });
  const basePath = path.join(directory, "base");
  fs.mkdirSync(basePath);
  createDataset(basePath, { datasetId: "テスト" });
  fs.writeFileSync(path.join(configDirectory, "setting.json"), JSON.stringify({ schemaVersion: 2, port, machineId: "test-machine-0001", basePath: fs.realpathSync(basePath) }));
  fs.writeFileSync(path.join(configDirectory, "integrations.json"), JSON.stringify({ schemaVersion: 1, clients: [{ id: "activity-test", name: "Activity", token: "activity-token-not-for-production", permissions: ["activity:write"] }] }));
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/server.js")], { cwd: projectRoot, env: { ...process.env, TICKTOCKTOME_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"] });
  const base = `http://127.0.0.1:${port}`, memoApi = `${base}/api/v1/integrations/memo`;
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* 起動中 */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
    const bootstrap = async () => (await (await fetch(`${base}/api/v1/bootstrap`)).json()).memoApp.installed;
    assert.equal(await bootstrap(), false);
    assert.equal((await fetch(`${memoApi}/memos`)).status, 401);
    assert.equal((await fetch(`${memoApi}/memos`, { headers: { Authorization: "Bearer activity-token-not-for-production" } })).status, 401);
    // 画面用の旧メモAPIは公開しない。
    assert.equal((await fetch(`${base}/api/v1/memos`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/memo.html`)).status, 404);

    const { token } = registerCompanion(path.join(configDirectory, "integrations.json"), "popnote");
    const auth = { Authorization: `Bearer ${token}` }, json = { ...auth, "Content-Type": "application/json" };
    assert.equal(await bootstrap(), process.platform === "darwin");
    const context = await (await fetch(`${memoApi}/context`, { headers: auth })).json();
    assert.ok(Array.isArray(context.tags) && Array.isArray(context.fileRoots));
    assert.equal(context.dataset.id, "テスト");
    assert.equal(context.dataset.basePath, fs.realpathSync(basePath));
    assert.match(context.dataset.key, /^[0-9a-f]{16}$/);
    // 想定と違うデータセットへの書き込みは409で止める。
    const mismatch = await fetch(`${memoApi}/memos`, { method: "POST", headers: { ...json, "X-TickTockTome-Dataset": "0000000000000000" }, body: "{}" });
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, "dataset-mismatch");
    const withKey = { ...json, "X-TickTockTome-Dataset": context.dataset.key };
    fs.writeFileSync(path.join(basePath, "agenda.txt"), "agenda");
    const referenced = await fetch(`${memoApi}/files:reference`, { method: "POST", headers: withKey, body: JSON.stringify({ relativePath: "agenda.txt" }) });
    assert.equal((await referenced.json()).item.relativePath, "agenda.txt");
    assert.equal((await fetch(`${memoApi}/files:reference`, { method: "POST", headers: withKey, body: JSON.stringify({ relativePath: "../outside.txt" }) })).status, 400);
    const created = await fetch(`${memoApi}/memos`, { method: "POST", headers: json, body: JSON.stringify({ bodyHtml: "<b>会議</b><script>x</script>" }) });
    assert.equal(created.status, 201);
    const item = (await created.json()).item;
    assert.equal(item.bodyHtml, "<b>会議</b>x");
    assert.match(item.title, /^\d{2}月\d{2}日\d{2}時\d{2}分\d{2}秒のノート$/);
    assert.equal((await (await fetch(`${memoApi}/memos?q=${encodeURIComponent("会議")}`, { headers: auth })).json()).items.length, 1);
    const inRange = new URLSearchParams({ from: new Date(Date.parse(item.createdAt) - 1000).toISOString(), to: new Date(Date.parse(item.createdAt) + 1000).toISOString() });
    assert.equal((await (await fetch(`${memoApi}/memos?${inRange}`, { headers: auth })).json()).items.length, 1);
    const later = new URLSearchParams({ from: new Date(Date.parse(item.createdAt) + 1000).toISOString() });
    assert.equal((await (await fetch(`${memoApi}/memos?${later}`, { headers: auth })).json()).items.length, 0);
    const updated = await fetch(`${memoApi}/memos/${item.id}`, { method: "PUT", headers: json, body: JSON.stringify({ title: "会議メモ", bodyHtml: "更新", revision: 1 }) });
    assert.equal((await updated.json()).item.revision, 2);
    const tag = (await (await fetch(`${memoApi}/tags`, { method: "POST", headers: json, body: JSON.stringify({ name: "会議" }) })).json()).item;
    assert.equal(tag.categoryId, "other");
    const pdf = await fetch(`${memoApi}/uploads`, { method: "POST", headers: json, body: JSON.stringify({ name: "a.pdf", mimeType: "application/pdf", base64: "JVBERg==" }) });
    assert.equal(pdf.status, 400);
    const calendar = (await (await fetch(`${base}/api/v1/calendar?month=${item.createdAt.slice(0, 7)}`)).json()).items;
    assert.ok(calendar.some((event) => event.id === item.id && event.eventType === "memo"));
    assert.equal((await fetch(`${memoApi}/memos/${item.id}`, { method: "DELETE", headers: json, body: JSON.stringify({ revision: 2 }) })).status, 200);
    assert.equal((await fetch(`${memoApi}/memos/${item.id}`, { headers: auth })).status, 404);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("連携アプリの登録は既存トークンを保ち、未対応のアプリを拒否する", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-companion-"));
  try {
    const integrationsPath = path.join(directory, "integrations.json");
    fs.writeFileSync(integrationsPath, JSON.stringify({ schemaVersion: 1, clients: [{ id: "command-center", token: "keep", permissions: ["search:read"] }] }));
    const first = registerCompanion(integrationsPath, "popnote");
    assert.match(first.token, /^[0-9a-f]{64}$/);
    assert.deepEqual(first.permissions, ["memo:read", "memo:write"]);
    assert.equal(registerCompanion(integrationsPath, "popnote").token, first.token);
    const saved = JSON.parse(fs.readFileSync(integrationsPath, "utf8"));
    assert.deepEqual(saved.clients.map((client) => client.id), ["command-center", "popnote"]);
    assert.throws(() => registerCompanion(integrationsPath, "unknown-app"), /未対応/);
  } finally { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
