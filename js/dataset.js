(function () {
"use strict";

// 基準パス（データセット）の選択・切替・ID変更・再リンクを扱う画面部品。
const api = window.TickTockTomeApi;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const kindNames = { library: "資料", managed: "ファイル", "journal-file": "日記の関連ファイル" };
let busy = false;

function currentRevision() {
  return window.__tickTockTomeBootstrap?.settingsRevision;
}

// 画面中央のポップアップ。押したボタンのvalue（フォームがあれば入力値も）を返す。
function popup({ eyebrow = "BASE PATH", title, body = "", actions }) {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    host.className = "setup-overlay dataset-popup";
    host.innerHTML = `<form class="setup-dialog" method="dialog"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2>${body}<p class="dataset-popup-error" role="alert"></p><div>${actions.map((action) => `<button type="${action.submit ? "submit" : "button"}" class="${action.primary ? "primary" : "secondary"}" value="${esc(action.value)}">${esc(action.label)}</button>`).join("")}</div></form>`;
    const form = host.querySelector("form");
    const finish = (value) => { host.remove(); resolve(value); };
    form.addEventListener("click", (event) => {
      const button = event.target.closest("button[type=button]");
      if (button) finish({ action: button.value, data: new FormData(form) });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      finish({ action: event.submitter?.value || "submit", data: new FormData(form) });
    });
    document.body.append(host);
    (form.querySelector("input:not([type=checkbox])") || form.querySelector(".primary"))?.focus();
  });
}

function lockMessage(holder) {
  const place = holder?.samePc ? "このPCの別のTomelet" : `「${holder?.hostname || "別のPC"}」`;
  return `${place}で使用中です。同時に開くと、片方の変更が失われるおそれがあります。`;
}

async function confirmForce(holder) {
  const result = await popup({ eyebrow: "IN USE", title: "このデータは使用中です", body: `<p>${esc(lockMessage(holder))}</p><p>相手側を終了できない場合だけ、このPCで開いてください。</p>`, actions: [{ label: "やめる", value: "cancel" }, { label: "このPCで開く", value: "force", primary: true }] });
  return result.action === "force";
}

async function apply(value) {
  try { return await api.applyDataset({ ...value, revision: currentRevision() }); }
  catch (error) {
    if (error.status !== 423 || value.force) throw error;
    if (!(await confirmForce(error.data?.lockHolder))) return null;
    return api.applyDataset({ ...value, force: true, revision: currentRevision() });
  }
}

async function chooseBasePath() {
  if (busy) return;
  busy = true;
  try {
    const selection = await api.chooseDataset({ revision: currentRevision() });
    let result = null;
    if (selection.existing) {
      if (selection.current) { window.TickTockTomeDialog.alert(`既に「${selection.existing.datasetId}」を開いています。`); return; }
      const answer = await popup({ eyebrow: "SWITCH DATASET", title: `「${selection.existing.datasetId}」に切り替えますか？`, body: `<p>選択したフォルダには、Tomeletのデータが保存されています。</p><code class="dataset-path">${esc(selection.basePath)}</code>${selection.lockHolder ? `<p class="dataset-warning">${esc(lockMessage(selection.lockHolder))}</p>` : ""}`, actions: [{ label: "キャンセル", value: "cancel" }, { label: "切り替える", value: "switch", primary: true }] });
      if (answer.action !== "switch") return;
      result = await apply({ token: selection.token });
    } else {
      const migrate = selection.legacyAvailable ? `<label class="dataset-check"><input type="checkbox" name="migrateLegacy" checked><span><b>これまでのデータを引き継ぐ</b><small>日記・Todo・資料などを複製し、書籍・文書・ファイルの場所をこの基準パスからの相対パスへ変換します。元のデータは残します。</small></span></label>` : "";
      const answer = await popup({ eyebrow: "NEW DATASET", title: "この場所を基準パスにします", body: `<code class="dataset-path">${esc(selection.basePath)}</code><p>直下に隠しフォルダ「.kobito-tools」を作り、主要データを保存します。書籍・文書・ファイルはこのフォルダからの相対パスで管理します。</p><label class="dataset-field"><span>ID（このデータの名前）</span><input name="datasetId" required maxlength="60" placeholder="例：研究用、個人"></label>${migrate}`, actions: [{ label: "キャンセル", value: "cancel" }, { label: "作成して開く", value: "create", primary: true, submit: true }] });
      if (answer.action !== "create") return;
      result = await apply({ token: selection.token, datasetId: answer.data.get("datasetId"), migrateLegacy: answer.data.has("migrateLegacy") });
    }
    if (result) location.reload();
  } catch (error) {
    if (!/キャンセル|-128|canceled/i.test(error.message)) window.TickTockTomeDialog.alert(error.message);
  } finally { busy = false; }
}

// 一覧から選んだ基準パスへ、確認のうえ切り替える。
async function switchTo(entry) {
  if (busy || !entry) return;
  busy = true;
  try {
    const answer = await popup({ eyebrow: "SWITCH DATASET", title: `「${entry.datasetId}」に切り替えますか？`, body: `<code class="dataset-path">${esc(entry.basePath)}</code>${entry.available ? "" : '<p class="dataset-warning">このフォルダは現在見つかりません。接続や同期の状態を確認してください。</p>'}`, actions: [{ label: "キャンセル", value: "cancel" }, { label: "切り替える", value: "switch", primary: true }] });
    if (answer.action !== "switch") return;
    try { await api.switchDataset({ key: entry.key, revision: currentRevision() }); }
    catch (error) {
      if (error.status !== 423) throw error;
      if (!(await confirmForce(error.data?.lockHolder))) return;
      await api.switchDataset({ key: entry.key, force: true, revision: currentRevision() });
    }
    location.reload();
  } catch (error) { window.TickTockTomeDialog.alert(error.message); }
  finally { busy = false; }
}

function knownList(bootstrap, { allowForget = true } = {}) {
  const entries = bootstrap.knownDatasets || [];
  if (!entries.length) return '<p class="dataset-menu-empty">まだ基準パスを開いていません。</p>';
  return `<ul class="dataset-known-list">${entries.map((entry) => `<li class="${entry.current ? "current" : ""}${entry.available ? "" : " missing"}"><button type="button" data-dataset-switch="${esc(entry.key)}" ${entry.current ? "disabled" : ""} title="${esc(entry.basePath)}"><b>${esc(entry.datasetId || "（IDなし）")}</b><small>${entry.current ? "使用中" : entry.available ? esc(entry.basePath) : "見つかりません"}</small></button>${allowForget && !entry.current ? `<button type="button" class="dataset-forget" data-dataset-forget="${esc(entry.key)}" aria-label="一覧から外す" title="一覧から外す（データは消えません）">×</button>` : ""}</li>`).join("")}</ul>`;
}

// 画面右上の基準パス切替メニュー。
function switcher(bootstrap) {
  const current = bootstrap.dataset?.id || "";
  return `<div class="dataset-switcher"><button type="button" class="visibility-button dataset-switcher-button" data-dataset-menu aria-haspopup="true" title="基準パスを切り替える"><span>▤</span><b>${esc(current)}</b><i>▾</i></button><div class="dataset-menu" hidden><p class="eyebrow">BASE PATH</p>${knownList(bootstrap)}<button type="button" class="dataset-menu-choose" data-dataset-choose>＋ 別のフォルダを選ぶ…</button></div></div>`;
}

function setupStatus(setup) {
  if (setup.status === "locked") return lockMessage(setup.lockHolder);
  if (setup.status === "missing") return setup.message || "基準パスのデータが見つかりません。";
  return "書籍・文書・ファイルと主要データを管理する基準パスを1か所選んでください。";
}

function renderSetup(app, bootstrap) {
  const setup = bootstrap.setup || {};
  document.body.classList.add("dataset-setup-mode");
  const title = setup.status === "locked" ? "基準パスは使用中です" : setup.status === "missing" ? "基準パスが見つかりません" : "基準パスの設定";
  app.innerHTML = `<section class="dataset-setup"><div class="setup-dialog"><img class="dataset-setup-mark" src="/favicon.svg?v=4" alt=""><p class="eyebrow">BASE PATH</p><h2>${esc(title)}</h2><p>${esc(setupStatus(setup))}</p>${setup.basePath ? `<code class="dataset-path">${esc(setup.basePath)}</code>` : ""}${setup.legacyAvailable ? "<p>これまでのデータは、新しい基準パスを作成するときに引き継げます。</p>" : ""}${(bootstrap.knownDatasets || []).length ? `<div class="dataset-setup-known"><span>これまでに開いた基準パス</span>${knownList(bootstrap, { allowForget: false })}</div>` : ""}<div>${setup.status === "locked" ? '<button class="secondary" data-dataset-force>このPCで開く</button>' : ""}${setup.status !== "unset" ? '<button class="secondary" data-dataset-retry>再確認</button>' : ""}<button class="primary" data-dataset-choose>基準パスを選択</button></div></div></section>`;
}

function settingsCard(bootstrap) {
  const info = bootstrap.dataset || {};
  const unresolved = info.unresolved || [];
  const relink = unresolved.length ? `<div class="dataset-relink"><h3>要再リンク <small>${unresolved.length}件</small></h3><p>基準パスの外を指しているため開けない項目です。基準パス内の同じファイルを選び直してください。</p>${unresolved.map((item) => `<div class="simple-row"><span><strong>${esc(item.name)}</strong><small>${esc(kindNames[item.kind] || item.kind)} · 旧${esc(item.rootId)}/${esc(item.relativePath)}</small></span><button class="secondary" data-dataset-relink="${esc(item.kind)}" data-id="${esc(item.id)}">再リンク</button></div>`).join("")}</div>` : "";
  return `<section class="settings-card dataset-settings"><h2>基準パス</h2><p>書籍・文書・ファイルは、すべてこの基準パスからの相対パスで管理します。主要データは直下の「${esc(info.directoryName || ".kobito-tools")}」に保存します。</p><div class="dataset-summary"><form class="dataset-id-form" data-dataset-id-form><label><span>ID</span><input name="datasetId" required maxlength="60" value="${esc(info.id)}"></label><button class="secondary">IDを保存</button></form><div><span>場所</span><code class="dataset-path">${esc(info.basePath)}</code></div></div><div class="dataset-actions"><button class="new-button" data-dataset-choose>別の基準パスへ切替・新規作成</button></div>${popnoteSetting(bootstrap)}${relink}</section>`;
}

// PopNote!のメモ（.kobito-tools/PopNote/）を本体のカレンダー・検索にも表示するか。
function popnoteSetting(bootstrap) {
  const popnote = bootstrap.popnote || {};
  if (!popnote.detected && popnote.show == null) return "";
  const shown = popnote.show === true;
  return `<div class="dataset-popnote"><h3>PopNote!のメモ</h3><p>${shown ? "PopNote!のメモを、カレンダー・検索・ファイルにも表示しています（編集はPopNote!で行います）。" : "PopNote!のメモは、この画面には表示していません。"}</p><button class="secondary" data-popnote-show="${shown ? "false" : "true"}">${shown ? "表示しない" : "本アプリでも表示する"}</button></div>`;
}

async function savePopNoteMemos(show) {
  const bootstrap = window.__tickTockTomeBootstrap;
  await api.updatePopNoteMemos({ revision: bootstrap.settingsRevision, show });
  location.reload();
}

// 起動時、PopNote!のデータがあり、まだ表示するか決めていなければ一度だけ尋ねる。答えはデータセットに保存する。
let popnoteAsked = false;
async function askPopNoteMemos(bootstrap) {
  if (popnoteAsked || !bootstrap.popnote?.detected || bootstrap.popnote.show != null) return;
  popnoteAsked = true;
  const show = await window.TickTockTomeDialog.confirm("PopNote!のデータが確認されました。本アプリ上でも表示しますか？", { okLabel: "表示する", cancelLabel: "表示しない" });
  try { await savePopNoteMemos(show); } catch (error) { window.TickTockTomeDialog.alert(error.message); }
}

document.addEventListener("click", async (event) => {
  const menu = document.querySelector(".dataset-menu");
  if (menu && !menu.hidden && !event.target.closest(".dataset-switcher")) menu.hidden = true;
  const target = event.target.closest("[data-dataset-menu],[data-dataset-switch],[data-dataset-forget],[data-dataset-choose],[data-dataset-retry],[data-dataset-force],[data-dataset-relink],[data-popnote-show]");
  if (!target) return;
  event.preventDefault();
  if (target.dataset.popnoteShow) { try { await savePopNoteMemos(target.dataset.popnoteShow === "true"); } catch (error) { window.TickTockTomeDialog.alert(error.message); } return; }
  const known = (key) => (window.__tickTockTomeBootstrap?.knownDatasets || []).find((entry) => entry.key === key);
  if (target.hasAttribute("data-dataset-menu")) { if (menu) menu.hidden = !menu.hidden; return; }
  if (target.dataset.datasetSwitch) { if (menu) menu.hidden = true; await switchTo(known(target.dataset.datasetSwitch)); return; }
  if (target.dataset.datasetForget) {
    const entry = known(target.dataset.datasetForget);
    if (!entry || !(await window.TickTockTomeDialog.confirm(`「${entry.datasetId}」を一覧から外しますか？（フォルダ内のデータは消えません）`, { okLabel: "外す" }))) return;
    try { await api.forgetDataset({ key: entry.key, revision: currentRevision() }); location.reload(); } catch (error) { window.TickTockTomeDialog.alert(error.message); }
    return;
  }
  if (menu) menu.hidden = true;
  if (target.hasAttribute("data-dataset-choose")) { await chooseBasePath(); return; }
  if (target.hasAttribute("data-dataset-retry")) { location.reload(); return; }
  if (target.hasAttribute("data-dataset-force")) {
    // 使用中で開けなかった現在の基準パスを、確認のうえこのPCで開き直す。
    const setup = window.__tickTockTomeBootstrap?.setup;
    if (!(await confirmForce(setup?.lockHolder))) return;
    try { await api.reopenDataset({ force: true, revision: currentRevision() }); location.reload(); }
    catch (error) { window.TickTockTomeDialog.alert(error.message); }
    return;
  }
  try {
    const picked = await api.pickPath("base", "file");
    await api.relinkReference({ kind: target.dataset.datasetRelink, id: target.dataset.id, relativePath: picked.relativePath });
    await window.onSettingsChanged();
  } catch (error) { if (!/キャンセル|-128|canceled/i.test(error.message)) window.TickTockTomeDialog.alert(error.message); }
});

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-dataset-id-form]");
  if (!form) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    await api.updateDatasetId({ datasetId: new FormData(form).get("datasetId"), revision: currentRevision() });
    await window.onSettingsChanged();
  } catch (error) { window.TickTockTomeDialog.alert(error.message); }
}, true);

window.TickTockTomeDataset = Object.freeze({ renderSetup, settingsCard, switcher, chooseBasePath, askPopNoteMemos });
})();
