"use strict";

// README用のデモGIFを作る。実データには触れず、一時フォルダのデモデータでサーバーを起動し、
// ヘッドレスのGoogle ChromeをDevTools Protocolで操作しながら撮影して、ffmpegでGIFにする。
// 使い方: node tools/record-demo.js [出力先.gif]   （Google Chrome と ffmpeg が必要）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const output = path.resolve(process.argv[2] || path.join(projectRoot, "docs", "images", "demo.gif"));
const chrome = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 43188, debugPort = 9339, width = 1280, height = 800;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, label, timeout = 15000) {
  const started = Date.now();
  for (;;) {
    try { const value = await check(); if (value) return value; } catch { /* 起動待ち */ }
    if (Date.now() - started > timeout) throw new Error(`${label}の起動を待てませんでした。`);
    await wait(200);
  }
}

// デモ用に、今日の予定とTodoを足す（create-demo-data.jsの内容は過去の日付のため）。
async function seed(base) {
  const call = async (pathname, body) => {
    const response = await fetch(`${base}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`${pathname}: ${await response.text()}`);
    return response.json();
  };
  const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const later = (days) => { const d = new Date(now); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const empty = { fileIds: [], managedFileIds: [], libraryIds: [], uploadIds: [], completions: [], location: "" };
  const actions = [["09:00", "10:00", "メールと予定の確認", ["daily-review"], 100], ["10:30", "12:00", "画面の設計を見直す", ["app-design"], 60], ["13:30", "15:00", "統計の教科書を読む", ["statistics", "reading"], 30], ["16:00", "17:30", "READMEを書く", ["programming"], 0]];
  for (const [index, [startTime, endTime, action, tagIds, progress]] of actions.entries()) await call("/api/v1/daily-actions", { ...empty, actionDate: date, startTime, endTime, action, tagIds, progress, displayOrder: index + 1 });
  const todos = [["リリースノートを書く", 1, ["programming"], 40], ["参考文献を整理する", 2, ["reading"], 10], ["来週の予定を立てる", 3, ["daily-review"], 0]];
  for (const [title, days, tagIds, progress] of todos) await call("/api/v1/todos", { title, dueDate: later(days), progress, tagIds, managedFileIds: [], libraryIds: [], folderPaths: [] });
}

class Page {
  constructor(url) { this.socket = new WebSocket(url); this.id = 0; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = (event) => { const message = JSON.parse(event.data); const pending = this.pending.get(message.id); if (pending) { this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result); } };
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); return result.result?.value; }
  close() { this.socket.close(); }
}

// 演出：ホーム → Todo → 時間割 → カレンダー → 活動分析 → 作業ツリー → 書籍 → ホーム。ナビゲーションの小人が走って移動する。
const scenes = [["dashboard", 2600], ["todo", 2600], ["goals", 3000], ["calendar", 2800], ["analysis", 2800], ["worktree", 2600], ["books", 3000], ["dashboard", 1800]];

async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "tomelet-demo-"));
  const dataDirectory = path.join(work, "data"), framesDirectory = path.join(work, "frames");
  fs.mkdirSync(framesDirectory);
  const children = [];
  try {
    const demo = spawnSync(process.execPath, [path.join(projectRoot, "tools", "create-demo-data.js"), "--data-dir", dataDirectory], { encoding: "utf8" });
    if (demo.status !== 0) throw new Error(demo.stderr || "デモデータを作れませんでした。");
    const env = { ...process.env, TICKTOCKTOME_DATA_DIR: dataDirectory, TICKTOCKTOME_PORT: String(port) };
    children.push(spawn(process.execPath, [path.join(projectRoot, "scripts", "server.js")], { env, stdio: "ignore" }));
    const base = `http://localhost:${port}`;
    await until(async () => (await fetch(`${base}/api/v1/bootstrap`)).ok, "Tomeletのサーバー");
    await seed(base);

    children.push(spawn(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${path.join(work, "chrome")}`, `--window-size=${width},${height}`, "--force-device-scale-factor=1", "about:blank"], { stdio: "ignore" }));
    const target = await until(async () => (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((item) => item.type === "page"), "Chrome");
    const page = new Page(target.webSocketDebuggerUrl);
    await page.open();
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.enable");
    await page.send("Page.navigate", { url: `${base}/` });
    await until(() => page.evaluate("Boolean(document.querySelector('[data-view=\"todo\"]'))"), "画面");
    // 起動時の「終了時間を過ぎたアクション」の確認は、撮影前に「後で」で閉じる。
    await wait(2000);
    for (let i = 0; i < 10 && await page.evaluate("Boolean(document.querySelector('[data-overdue-later]'))"); i += 1) { await page.evaluate("document.querySelector('[data-overdue-later]').click()"); await wait(400); }
    await wait(600);

    const frames = [];
    for (const [view, duration] of scenes) {
      await page.evaluate(`document.querySelector('[data-view="${view}"]')?.click()`);
      const sceneEnd = Date.now() + duration;
      while (Date.now() < sceneEnd) {
        const shot = await page.send("Page.captureScreenshot", { format: "png" });
        const file = path.join(framesDirectory, `frame_${String(frames.length).padStart(4, "0")}.png`);
        fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
        frames.push({ file, at: Date.now() });
      }
    }
    page.close();

    // 撮影できた時刻の間隔をそのまま表示時間にして、実際の速さで再生されるようにする。
    const list = frames.map((frame, index) => `file '${frame.file}'\nduration ${(((frames[index + 1]?.at ?? frame.at + 1500) - frame.at) / 1000).toFixed(3)}`).join("\n");
    fs.writeFileSync(path.join(work, "frames.txt"), `${list}\nfile '${frames.at(-1).file}'\n`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const encode = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "frames.txt"), "-vf", "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", output], { encoding: "utf8" });
    if (encode.status !== 0) throw new Error(encode.stderr || "GIFを作れませんでした。");
    console.log(`${output}（${frames.length}コマ）`);
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await wait(500);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
