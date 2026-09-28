"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../../scripts/database/connection.js");
const { createDataset } = require("../../scripts/dataset.js");
const { popnoteDatabasePath } = require("../../scripts/popnote-memos.js");
const { registerCompanion } = require("../../scripts/integrations/companions.js");

const projectRoot = path.resolve(__dirname, "../..");

function reservePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const { port } = socket.address(); socket.close((error) => error ? reject(error) : resolve(port)); });
  });
}

async function waitForServer(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) { try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* 起動中 */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error("テストサーバーが起動しませんでした。");
}

// PopNote!が .kobito-tools/PopNote/ に保存したのと同じ形のDBを用意する。
function writePopNoteMemo(basePath, { tagId = null, upload = null } = {}) {
  for (const name of ["database", "uploads"]) fs.mkdirSync(path.join(basePath, ".kobito-tools", "PopNote", name), { recursive: true });
  const popnote = openDatabase(popnoteDatabasePath(basePath), projectRoot);
  try {
    const createdAt = new Date().toISOString();
    popnote.prepare("INSERT INTO memos(id, title, body_html, body_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(memoId, "会議メモ", "<b>会議</b>", "会議", createdAt, createdAt);
    if (tagId) popnote.prepare("INSERT INTO memo_tags(memo_id, tag_id) VALUES (?, ?)").run(memoId, tagId);
    if (upload) {
      fs.writeFileSync(path.join(basePath, ".kobito-tools", "PopNote", "uploads", upload.storedName), upload.content);
      popnote.prepare("INSERT INTO managed_uploads(id, stored_name, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, 'a.png', 'image/png', ?, ?)").run(upload.id, upload.storedName, upload.content.length, createdAt);
      popnote.prepare("INSERT INTO memo_uploads(memo_id, upload_id) VALUES (?, ?)").run(memoId, upload.id);
    }
    return createdAt;
  } finally { popnote.close(); }
}

const memoId = "memo-00000000-0000-4000-8000-000000000001";

test("PopNote!のデータがあれば表示するかを尋ね、表示する場合だけメモの写しをカレンダーへ出す", async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-memo-http-")));
  const port = await reservePort();
  const configDirectory = path.join(directory, "config");
  fs.mkdirSync(configDirectory, { recursive: true });
  const basePath = path.join(directory, "base");
  fs.mkdirSync(basePath);
  createDataset(basePath, { datasetId: "テスト" });
  const upload = { id: "upload-00000000-0000-4000-8000-000000000002", storedName: "pasted.png", content: Buffer.from("png-bytes") };
  const createdAt = writePopNoteMemo(basePath, { upload });
  fs.writeFileSync(path.join(configDirectory, "setting.json"), JSON.stringify({ schemaVersion: 2, port, machineId: "test-machine-0001", basePath }));
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/server.js")], { cwd: projectRoot, env: { ...process.env, TICKTOCKTOME_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"] });
  const base = `http://127.0.0.1:${port}`;
  const calendarHasMemo = async () => (await (await fetch(`${base}/api/v1/calendar?month=${createdAt.slice(0, 7)}`)).json()).items.some((event) => event.id === memoId && event.eventType === "memo");
  const setShow = async (show) => { const { settingsRevision } = await (await fetch(`${base}/api/v1/bootstrap`)).json(); return fetch(`${base}/api/v1/settings/popnote-memos`, { method: "PUT", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ revision: settingsRevision, show }) }); };
  try {
    await waitForServer(base);
    assert.deepEqual((await (await fetch(`${base}/api/v1/bootstrap`)).json()).popnote, { detected: true, show: null });
    assert.equal(await calendarHasMemo(), false, "回答するまでは表示しない");
    assert.equal((await setShow(true)).status, 200);
    assert.equal(await calendarHasMemo(), true);
    assert.equal((await fetch(`${base}/api/v1/search?q=${encodeURIComponent("会議")}`).then((response) => response.json())).memos.length, 1);
    const image = await fetch(`${base}/api/v1/uploads/${upload.id}/content`);
    assert.equal(Buffer.from(await image.arrayBuffer()).toString(), "png-bytes", "画像はPopNote/uploads/から配信する");
    assert.equal((await (await fetch(`${base}/api/v1/bootstrap`)).json()).popnote.show, true, "回答はデータセットに保存する");
    assert.equal(JSON.parse(fs.readFileSync(path.join(basePath, ".kobito-tools", "dataset.json"), "utf8")).settings.showPopNoteMemos, true);
    // PopNote!側でメモを消すと、次の読み込みで本体の表示からも消える。
    const popnote = openDatabase(popnoteDatabasePath(basePath), projectRoot);
    try { popnote.prepare("UPDATE memos SET deleted_at = ?, revision = revision + 1 WHERE id = ?").run(new Date().toISOString(), memoId); } finally { popnote.close(); }
    assert.equal(await calendarHasMemo(), false);
    // 本体で作ったタグは共有タグ（Tags/tags.json）へすぐ書き出す。
    const tag = await fetch(`${base}/api/v1/tags`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ id: "tag-shared", categoryId: "other", name: "共有", displayOrder: 1 }) });
    assert.equal(tag.status, 201);
    assert.ok(JSON.parse(fs.readFileSync(path.join(basePath, ".kobito-tools", "Tags", "tags.json"), "utf8")).tags.some((item) => item.id === "tag-shared"));
    assert.equal((await setShow(false)).status, 200);
    assert.equal((await setShow("yes")).status, 400);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("PopNote!向け連携APIは開いている基準パスだけを返し、メモの書き込みは受け付けない", async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ticktocktome-memo-context-")));
  const port = await reservePort();
  const configDirectory = path.join(directory, "config");
  fs.mkdirSync(configDirectory, { recursive: true });
  const basePath = path.join(directory, "base");
  fs.mkdirSync(basePath);
  createDataset(basePath, { datasetId: "テスト" });
  fs.writeFileSync(path.join(configDirectory, "setting.json"), JSON.stringify({ schemaVersion: 2, port, machineId: "test-machine-0001", basePath }));
  fs.writeFileSync(path.join(configDirectory, "integrations.json"), JSON.stringify({ schemaVersion: 1, clients: [{ id: "activity-test", name: "Activity", token: "activity-token-not-for-production", permissions: ["activity:write"] }] }));
  const child = spawn(process.execPath, [path.join(projectRoot, "scripts/server.js")], { cwd: projectRoot, env: { ...process.env, TICKTOCKTOME_DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"] });
  const base = `http://127.0.0.1:${port}`, memoApi = `${base}/api/v1/integrations/memo`;
  try {
    await waitForServer(base);
    const installed = async () => (await (await fetch(`${base}/api/v1/bootstrap`)).json()).memoApp.installed;
    assert.equal(await installed(), false);
    assert.equal((await fetch(`${memoApi}/context`)).status, 401);
    assert.equal((await fetch(`${memoApi}/context`, { headers: { Authorization: "Bearer activity-token-not-for-production" } })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/memos`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: "{}" })).status, 404);

    const { token } = registerCompanion(path.join(configDirectory, "integrations.json"), "popnote");
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal(await installed(), process.platform === "darwin");
    const context = await (await fetch(`${memoApi}/context`, { headers: auth })).json();
    assert.equal(context.dataset.id, "テスト");
    assert.equal(context.dataset.basePath, basePath);
    assert.match(context.dataset.key, /^[0-9a-f]{16}$/);
    const write = await fetch(`${memoApi}/memos`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(write.status, 410);
    assert.equal((await write.json()).code, "popnote-update-required");
    assert.equal((await fetch(`${memoApi}/memos`, { headers: auth })).status, 410);
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
