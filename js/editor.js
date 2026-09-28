(function () {
"use strict";

const host = document.querySelector("#editorApp");
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
let current = null;
let dirty = false;
let editorType = "journal";

function fileRow(file = {}) {
  // 基準パス外を指す旧参照は、その行でだけ選択肢に残す。
  const roots = (window.__tickTockTomeBootstrap?.fileRoots || []).filter((root) => !root.legacy || root.id === file.rootId);
  return `<div class="journal-file-row" data-file-id="${esc(file.id || "")}"><select data-file-root aria-label="基準フォルダ">${roots.map((root) => `<option value="${esc(root.id)}" ${file.rootId === root.id ? "selected" : ""}>${esc(root.displayName)}</option>`).join("")}</select><span class="path-picker"><input data-file-path value="${esc(file.relativePath || "")}" placeholder="未選択" readonly><span><button type="button" data-pick-path="file">ファイル…</button><button type="button" data-pick-path="folder">フォルダ…</button></span></span><select data-file-type><option value="file" ${file.targetType !== "folder" ? "selected" : ""}>ファイル</option><option value="folder" ${file.targetType === "folder" ? "selected" : ""}>フォルダ</option></select><button type="button" data-remove-file>×</button><input data-file-name value="${esc(file.displayName || "")}" placeholder="表示名（任意）"><input data-file-note value="${esc(file.note || "")}" placeholder="説明（任意）"></div>`;
}

function groupedTagChoices(selectedIds = []) {
  const bootstrap = window.__tickTockTomeBootstrap;
  const colors = ["#477b70", "#c75543", "#9b7432", "#5c668f", "#7b587d"];
  const groups = bootstrap.tagCategories.map((category, index) => {
    const tags = bootstrap.tags.filter((tag) => tag.categoryId === category.id);
    if (!tags.length) return "";
    return `<div class="check-group" style="--category:${colors[index % colors.length]}"><b>${esc(category.name)}</b><div>${tags.map((tag) => `<label class="check-chip"><input type="checkbox" name="tagIds" value="${esc(tag.id)}" ${selectedIds.includes(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("")}</div></div>`;
  }).join("");
  return groups || '<p class="check-title">タグはまだありません。</p>';
}

function render(item = null, defaultDate = "") {
  editorType = "journal";
  current = item;
  dirty = false;
  const today = defaultDate || new Date().toLocaleDateString("sv-SE");
  const bootstrap = window.__tickTockTomeBootstrap;
  host.innerHTML = `<main class="editor"><section class="detail"><button type="button" class="close editor-close" data-close-editor>×</button><form id="journalForm" class="record-form"><div class="form-head"><div><p class="eyebrow">JOURNAL EDITOR</p><h2>${item ? "日記を編集" : "今日の日記"}</h2><div class="form-actions"><button type="button" class="secondary" data-close-editor>編集：ON</button>${item ? '<button type="button" class="danger" data-delete-journal>削除</button>' : ""}<button class="primary" type="submit">検証して保存</button></div></div></div><div class="form-section"><h3>01 / 日記</h3><div class="field-grid"><label class="field"><span>日付</span><input name="entryDate" type="date" required value="${esc(item?.entryDate || today)}"></label><label class="field wide"><span>題名</span><input name="title" required maxlength="300" value="${esc(item?.title || "")}"></label><label class="field wide"><span>本文（Markdown）</span><textarea name="bodyMarkdown" rows="14">${esc(item?.bodyMarkdown || "")}</textarea></label></div></div><div class="form-section"><h3>02 / タグ</h3><div class="check-groups">${bootstrap.tags.length ? bootstrap.tags.map((tag) => `<label class="check-chip"><input type="checkbox" name="tagIds" value="${esc(tag.id)}" ${item?.tagIds.includes(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("") : '<p class="check-title">タグはまだありません。</p>'}</div></div><div class="form-section"><h3>03 / 関連ファイル・フォルダ</h3><p class="privacy-note">ファイル本体は保存しません。設定した基準パスのIDと相対パスだけを記録します。</p><div class="journal-editor-files">${(item?.files || []).map(fileRow).join("")}</div>${bootstrap.fileRoots.length ? '<button type="button" class="add-row" data-add-file>＋ パスを追加</button>' : '<p class="check-title">設定画面で基準パスを登録してください。</p>'}</div><div id="validationMessage"></div></form></section></main>`;
  host.querySelector("#journalForm .check-groups").innerHTML = groupedTagChoices(item?.tagIds || []);
  if (!item) host.querySelector("#journalForm .form-actions .primary").insertAdjacentHTML("beforebegin", '<button type="button" class="secondary" data-discard-editor>取り消す</button>');
  host.hidden = false;
  document.body.classList.add("editing-mode");
}

function renderTag() {
  editorType = "tag"; current = null; dirty = false;
  const categories = window.__tickTockTomeBootstrap.tagCategories;
  host.innerHTML = `<main class="editor"><section class="detail"><button type="button" class="close editor-close" data-close-editor>×</button><form id="tagForm" class="record-form"><div class="form-head"><div><p class="eyebrow">TAG EDITOR</p><h2>タグを追加</h2><div class="form-actions"><button type="button" class="secondary" data-close-editor>閉じる</button><button class="primary" type="submit">保存</button></div></div></div><div class="form-section"><h3>01 / タグ</h3><div class="field-grid"><label class="field"><span>内部ID</span><input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="例: health"></label><label class="field"><span>表示名</span><input name="name" required placeholder="例: 健康"></label><label class="field"><span>分類</span><select name="categoryId">${categories.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></label><label class="field"><span>表示順</span><input name="displayOrder" type="number" min="1" value="${window.__tickTockTomeBootstrap.tags.length + 1}"></label><label class="field wide"><span>説明</span><textarea name="description"></textarea></label></div></div><div id="validationMessage"></div></form></section></main>`;
  host.hidden = false; document.body.classList.add("editing-mode");
}

const libraryLabels = {
  book: { singular: "書籍", publication: "出版社・版" },
  paper: { singular: "文書", publication: "掲載誌・会議・発行元" },
};

function renderLibrary(itemType, item = null) {
  editorType = "library"; current = item; dirty = false;
  const label = libraryLabels[itemType];
  const tags = window.__tickTockTomeBootstrap.tags;
  const journals = window.__tickTockTomeJournals || [];
  const authorRow=(name="")=>`<div class="author-row"><input name="authors" list="authorHistory" required value="${esc(name)}" placeholder="著者・編者名"><button type="button" class="secondary" data-remove-author>×</button></div>`;
  const authorRows=(item?.authors?.length?item.authors:[""]).map(authorRow).join("");
  const history=(window.__tickTockTomeBootstrap.authorSuggestions||[]).map(name=>`<option value="${esc(name)}"></option>`).join("");
  const tagGroups=window.__tickTockTomeBootstrap.tagCategories.map(category=>{const entries=tags.filter(tag=>tag.categoryId===category.id);return entries.length?`<fieldset class="editor-tag-group"><legend>${esc(category.name)}</legend>${entries.map(tag=>`<label class="check-chip"><input type="checkbox" name="tagIds" value="${esc(tag.id)}" ${item?.tagIds.includes(tag.id)?"checked":""}><span>${esc(tag.name)}</span></label>`).join("")}</fieldset>`:""}).join("");
  const paperFields = itemType === "paper" ? `<label class="field wide"><span>キーワード（カンマ区切り）</span><input name="keywords" value="${esc((item?.keywords || []).join(", "))}"></label><label class="field"><span>DOI</span><input name="doi" placeholder="10.xxxx/..." value="${esc(item?.doi || "")}"></label><label class="field wide"><span>BibTeXコード</span><textarea name="bibtexCode" rows="9" placeholder="@article{...}">${esc(item?.bibtexCode || "")}</textarea></label>` : "";
  const rootId=item?.sourceRootId||"base",root=window.__tickTockTomeBootstrap.fileRoots.find(entry=>entry.id==="base");
  const llm=window.__tickTockTomeBootstrap.localLlm?.enabled?'<div class="validation">ローカルLLMが設定済みです。PDFを選択すると書誌情報の抽出を試みます。</div>':'<div class="privacy-note">自動抽出は無効です。設定画面でローカルLLMをセットアップすると利用できます。</div>';
  host.innerHTML = `<main class="editor"><section class="detail"><button type="button" class="close editor-close" data-close-editor>×</button><form id="libraryForm" class="record-form" data-item-type="${itemType}"><div class="form-head"><div><p class="eyebrow">LIBRARY EDITOR</p><h2>${item ? `${label.singular}を編集` : `${label.singular}を追加`}</h2><div class="form-actions"><button type="button" class="secondary" data-close-editor>編集：ON</button>${item ? '<button type="button" class="danger" data-delete-library>削除</button>' : ""}<button class="primary" type="submit">検証して保存</button></div></div></div><label class="library-favorite-top"><input type="checkbox" name="favorite" ${item?.favorite ? "checked" : ""}><span>★ お気に入り</span></label>${llm}<div class="form-section"><h3>01 / 書誌情報</h3><div class="field-grid"><label class="field wide"><span>PDF参照（本体はコピーしません）</span><input type="hidden" name="sourceRootId" value="${esc(rootId)}"><input name="sourceRelativePath" readonly value="${esc(item?.sourceRelativePath || '')}" placeholder="${root?'未選択':'設定画面で基準パスを設定してください'}"><button type="button" class="secondary" data-library-pdf ${root?'':'disabled'}>PDFを選択・変更</button></label><label class="field"><span>状態</span><select name="status">${[["unverified","未確認"],["unread","未読"],["reading","読書中"],["read","読了"],["cited","参照済み"]].map(([value,name]) => `<option value="${value}" ${(item?.status||"unverified") === value ? "selected" : ""}>${name}</option>`).join("")}</select></label><label class="field"><span>優先度（1〜5）</span><input name="priority" type="number" min="1" max="5" value="${item?.priority || 3}"></label><label class="field wide"><span>題名</span><input name="title" required maxlength="500" value="${esc(item?.title || "")}"></label><div class="field wide author-list-field"><span>著者・編者</span><datalist id="authorHistory">${history}</datalist><div data-author-list>${authorRows}</div><button type="button" class="secondary" data-add-author>＋ 著者を追加</button></div><label class="field"><span>出版年</span><input name="year" type="number" min="1000" max="2200" value="${esc(item?.year || "")}"></label><label class="field"><span>${label.publication}</span><input name="publication" value="${esc(item?.publication || "")}"></label>${paperFields}<label class="field wide"><span>HTTPS URL</span><input name="url" type="url" placeholder="https://..." value="${esc(item?.url || "")}"></label><label class="field wide"><span>メモ（Markdown・LaTeX）</span><textarea name="takeawayMarkdown" rows="10">${esc(item?.takeawayMarkdown || "")}</textarea></label></div></div><div class="form-section"><h3>02 / タグ</h3><div class="editor-tag-groups">${tagGroups||'<p>タグは設定画面から追加できます。</p>'}</div></div><div class="form-section"><h3>03 / 関連する日記</h3><div class="check-groups library-journal-links">${journals.length ? journals.slice(0, 100).map((journal) => `<label class="check-chip"><input type="checkbox" name="journalIds" value="${esc(journal.id)}" ${item?.journalIds.includes(journal.id) ? "checked" : ""}><span>${esc(journal.entryDate)} · ${esc(journal.title)}</span></label>`).join("") : '<p class="check-title">関連付けられる日記はまだありません。</p>'}</div></div><div id="validationMessage"></div></form></section></main>`;
  if (itemType !== "paper") {
    const section = host.querySelector("#libraryForm .form-section");
    section?.insertAdjacentHTML("afterbegin", `<label class="field wide library-cover-input"><span>表紙画像</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/heic" data-library-cover><input type="hidden" name="coverUploadId" value="${esc(item?.coverUploadId || "")}"><small>画像実体はGit管理外のアプリ用データ領域へ保存されます。</small></label>`);
  }
  host.hidden = false; document.body.classList.add("editing-mode");
}

async function close() {
  if (dirty && !(await window.TickTockTomeDialog.confirm("保存していない変更を破棄しますか？", { okLabel: "破棄する", danger: true }))) return;
  host.hidden = true;
  host.innerHTML = "";
  document.body.classList.remove("editing-mode");
  current = null;
  dirty = false;
}

function values() {
  const form = host.querySelector("#journalForm");
  const data = new FormData(form);
  const files = [...host.querySelectorAll(".journal-file-row")].map((row) => ({ id: row.dataset.fileId || "", rootId: row.querySelector("[data-file-root]").value, relativePath: row.querySelector("[data-file-path]").value.trim(), targetType: row.querySelector("[data-file-type]").value, displayName: row.querySelector("[data-file-name]").value.trim(), note: row.querySelector("[data-file-note]").value.trim() })).filter((file) => file.relativePath);
  return { entryDate: data.get("entryDate"), title: data.get("title"), bodyMarkdown: data.get("bodyMarkdown"), tagIds: data.getAll("tagIds"), projectIds: current?.projectIds || [], files, ...(current ? { revision: current.revision } : {}) };
}

host.addEventListener("input", () => { dirty = true; });
host.addEventListener("change", async (event) => {
  if (!event.target.matches("[data-library-cover]") || !event.target.files?.[0]) return;
  const input = event.target, file = input.files[0], message = host.querySelector("#validationMessage");
  input.disabled = true;
  try {
    const base64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("画像を読み取れません。")); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.readAsDataURL(file); });
    const result = await window.TickTockTomeApi.upload({ name: file.name, mimeType: file.type, base64 });
    host.querySelector('[name="coverUploadId"]').value = result.item.id; dirty = true;
    message.innerHTML = `<div class="validation">表紙画像を追加しました。資料を保存すると反映されます。</div>`;
  } catch (error) { message.innerHTML = `<div class="validation">${esc(error.message)}</div>`; }
  finally { input.disabled = false; input.value = ""; }
});
host.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-close-editor],[data-discard-editor],[data-add-file],[data-remove-file],[data-pick-path],[data-delete-journal],[data-delete-library],[data-library-pdf],[data-add-author],[data-remove-author]");
  if (!target) return;
  if(target.hasAttribute("data-add-author")){host.querySelector("[data-author-list]").insertAdjacentHTML("beforeend",`<div class="author-row"><input name="authors" list="authorHistory" required placeholder="著者・編者名"><button type="button" class="secondary" data-remove-author>×</button></div>`);dirty=true;}
  else if(target.hasAttribute("data-remove-author")){if(host.querySelectorAll('.author-row').length>1)target.closest('.author-row').remove();else target.closest('.author-row').querySelector('input').value='';dirty=true;}
  else if (target.hasAttribute('data-library-pdf')) {
    try {const form=host.querySelector('#libraryForm'),message=host.querySelector('#validationMessage');const result=await window.TickTockTomeApi.pickPath('base','file');if(!/\.pdf$/i.test(result.relativePath))throw new Error('PDFを選択してください。');form.elements.sourceRootId.value='base';form.elements.sourceRelativePath.value=result.relativePath;dirty=true;if(window.__tickTockTomeBootstrap.localLlm?.enabled){message.innerHTML='<div class="validation">ローカルLLMで書誌情報を抽出しています…</div>';const extracted=await window.TickTockTomeApi.extractLibraryMetadata({itemType:form.dataset.itemType,rootId:form.elements.sourceRootId.value,relativePath:result.relativePath}),meta=extracted.metadata||{};for(const key of ['title','year','publication','doi','bibtexCode'])if(form.elements[key]&&meta[key]!=null)form.elements[key].value=meta[key];if(form.elements.keywords&&meta.keywords)form.elements.keywords.value=meta.keywords.join(', ');if(meta.authors?.length){const list=form.querySelector('[data-author-list]');list.innerHTML=meta.authors.map(name=>`<div class="author-row"><input name="authors" list="authorHistory" required value="${esc(name)}"><button type="button" class="secondary" data-remove-author>×</button></div>`).join('');}message.innerHTML='<div class="validation">候補を入力しました。内容を確認してから保存してください。</div>';}}
    catch(error){host.querySelector('#validationMessage').innerHTML=`<div class="validation">${esc(error.message)}</div>`;}
  }
  else if (target.hasAttribute("data-discard-editor")) { dirty = false; close(); }
  else if (target.hasAttribute("data-close-editor")) close();
  else if (target.hasAttribute("data-add-file")) { host.querySelector(".journal-editor-files").insertAdjacentHTML("beforeend", fileRow()); dirty = true; }
  else if (target.hasAttribute("data-remove-file")) { target.closest(".journal-file-row").remove(); dirty = true; }
  else if (target.dataset.pickPath) {
    const row = target.closest(".journal-file-row");
    target.disabled = true;
    try { const result = await window.TickTockTomeApi.pickPath(row.querySelector("[data-file-root]").value, target.dataset.pickPath); row.querySelector("[data-file-path]").value = result.relativePath; row.querySelector("[data-file-type]").value = target.dataset.pickPath; dirty = true; }
    catch (error) { if (!/キャンセル/.test(error.message)) host.querySelector("#validationMessage").innerHTML = `<div class="validation">${esc(error.message)}</div>`; }
    finally { target.disabled = false; }
  }
  else if (target.hasAttribute("data-delete-journal")) {
    if (!(await window.TickTockTomeDialog.confirm("この日記をゴミ箱へ移動しますか？", { okLabel: "移動する" }))) return;
    try { await window.TickTockTomeApi.deleteJournal(current.id, current.revision); dirty = false; close(); await window.onTickTockTomeChanged(); }
    catch (error) { host.querySelector("#validationMessage").innerHTML = `<div class="validation">${esc(error.message)}</div>`; }
  }
  else if (target.hasAttribute("data-delete-library")) {
    if (!(await window.TickTockTomeDialog.confirm("この資料を削除しますか？", { okLabel: "削除する", danger: true }))) return;
    try { const itemType = current.itemType; await window.TickTockTomeApi.deleteLibraryItem(current.id, current.revision); dirty = false; close(); await window.onLibraryChanged(itemType); }
    catch (error) { host.querySelector("#validationMessage").innerHTML = `<div class="validation">${esc(error.message)}</div>`; }
  }
});
host.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(event.target);
    let result;
    if (editorType === "tag") result = await window.TickTockTomeApi.createTag({ id: data.get("id"), name: data.get("name"), categoryId: data.get("categoryId"), description: data.get("description"), displayOrder: Number(data.get("displayOrder")) });
    else if (editorType === "library") {
      const itemType = event.target.dataset.itemType;
      const value = { itemType, title: data.get("title"), authors: data.getAll("authors").map(value=>String(value).trim()).filter(Boolean), year: data.get("year"), publication: data.get("publication"), status: data.get("status"), priority: Number(data.get("priority")), favorite: data.has("favorite"), keywords: String(data.get("keywords") || "").split(/[,、]/).map((value) => value.trim()).filter(Boolean), doi: data.get("doi") || "", bibtexCode: data.get("bibtexCode") || "", takeawayMarkdown: data.get("takeawayMarkdown"), url: data.get("url"), tagIds: data.getAll("tagIds"), journalIds: data.getAll("journalIds"), sourceRootId: data.get('sourceRelativePath') ? data.get('sourceRootId') : '', sourceRelativePath: data.get('sourceRelativePath') || '', coverUploadId: data.get("coverUploadId") || "", ...(current ? { revision: current.revision } : {}) };
      result = current ? await window.TickTockTomeApi.updateLibraryItem(current.id, value) : await window.TickTockTomeApi.createLibraryItem(value);
    }
    else result = current ? await window.TickTockTomeApi.updateJournal(current.id, values()) : await window.TickTockTomeApi.createJournal(values());
    dirty = false;
    close();
    if (editorType === "journal") await window.onTickTockTomeChanged(result.item.id);
    else if (editorType === "library") await window.onLibraryChanged(result.item.itemType, result.item.id);
    else await window.onSettingsChanged();
  } catch (error) { host.querySelector("#validationMessage").innerHTML = `<div class="validation"><strong>保存できませんでした</strong><br>${esc(error.message)}</div>`; }
});

window.TickTockTomeEditor = { open: async (item = null, defaultDate = "") => {
  if (!window.__tickTockTomeBootstrap) window.__tickTockTomeBootstrap = await window.TickTockTomeApi.bootstrap();
  render(item, defaultDate);
}, openTag: async () => { if (!window.__tickTockTomeBootstrap) window.__tickTockTomeBootstrap = await window.TickTockTomeApi.bootstrap(); renderTag(); }, openLibrary: async (itemType, item = null) => { if (!window.__tickTockTomeBootstrap) window.__tickTockTomeBootstrap = await window.TickTockTomeApi.bootstrap(); renderLibrary(itemType, item); } };
})();
