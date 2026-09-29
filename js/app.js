"use strict";

const app = document.querySelector("#app");
const api = window.TickTockTomeApi;
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shiftDate = (value, amount) => { const date = new Date(`${value}T12:00:00`); date.setDate(date.getDate() + amount); return localDate(date); };
const weekStart = (value = localDate()) => { const date = new Date(`${value}T12:00:00`); return shiftDate(value, -((date.getDay() + 6) % 7)); };
const state = { view: "dashboard", query: "", bootstrap: null, journals: [], timeline: [], calendar: [], calendarActions: [], calendarTodos: [], calendarMode: "month", calendarDay: localDate(), weekDate: new Date(), analysisDate: localDate(), analysis: null, workTree: [], files: [], fileTotal: 0, fileQuery: "", fileSort: "name", fileTagIds: new Set(), homeLibrary: [], libraryItems: [], goalFiles: [], goalLibraryItems: [], libraryMode: "board", month: new Date(new Date().getFullYear(), new Date().getMonth(), 1), goalDate: localDate(), dailyActions: [], recordActions: [], todayActions: [], recentActions: [], actionDrafts: [], graphTags: new Set(), hiddenTagIds: new Set(), tagPanelOpen: false, search: { journals: [], activities: [], files: [], library: [] }, trash: [], selected: null, selectedFile: null, selectedLibrary: null, selectedAction: null, actionChooser: false, actionResourceQueries:{book:"",paper:""}, libraryQuery:{book:"",paper:""}, librarySort:{book:"recommended",paper:"recommended"}, libraryTagIds:{book:new Set(),paper:new Set()}, libraryStatusFilter:{book:"",paper:""}, actionTagId: "", actionFileQuery: "", actionFileSort: "latest", notice: "", rootCheckDismissed: false };
const esc = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const renderMarkup = (value = "") => window.ResearchMarkup?.render(value) || `<p>${esc(value)}</p>`;
const plain = (value = "") => window.ResearchMarkup?.toPlainText(value) || String(value);
const dateText = (value, detail = false) => new Intl.DateTimeFormat("ja-JP", detail ? { year: "numeric", month: "long", day: "numeric" } : { month: "2-digit", day: "2-digit" }).format(new Date(`${String(value).slice(0, 10)}T00:00:00`));
const heading = (eyebrow, title, description = "", side = "") => `<div class="section-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${esc(title)}</h1>${description ? `<p>${esc(description)}</p>` : ""}</div>${side}</div>`;
const visibleByTags = (item) => !(item?.tagIds || []).some((id) => state.hiddenTagIds.has(id));
window.tickTockTomeVisibleByTags = visibleByTags;
window.tickTockTomeReloadView = (view) => loadView(view);
window.tickTockTomeTimerChanged = () => refreshActions();

function decorateActionForm(form) {
  if (!form) return;
  const progress=form.elements.progress;
  if (progress?.tagName === 'SELECT') { const value=Number(state.selectedAction?.progress??progress.value); progress.outerHTML=`<div class="progress-control"><input type="range" name="progress" min="0" max="100" step="1" value="${value}"><output>${value}%</output></div>`; }
  updateResourceLists(form);
}

function updateResourceLists(form) {
  form.querySelector('.action-file-browser-host').innerHTML=actionFileBrowserContent(state.selectedAction?.managedFileIds || []);
  for(const type of ['book','paper']){const host=form.querySelector(`[data-resource-list="${type}"]`);if(!host)continue;const query=(state.actionResourceQueries[type]||'').toLocaleLowerCase('ja');const entries=state.goalLibraryItems.filter(t=>t.itemType===type).filter(visibleByTags).filter(t=>(!state.actionTagId||t.tagIds.includes(state.actionTagId))&&(!query||`${t.title} ${t.authors.join(' ')}`.toLocaleLowerCase('ja').includes(query)));host.innerHTML=entries.map(t=>`<label class="goal-link"><input type="checkbox" name="libraryIds" value="${esc(t.id)}" ${(state.selectedAction?.libraryIds||[]).includes(t.id)?'checked':''}><span><strong>${esc(t.title)}</strong><small>${esc(t.authors.join(', ')||'著者未入力')}</small></span></label>`).join('')||'<p class="muted">該当する資料はありません。</p>';}
}

function decorateLibraryView() {
  const zone=app.querySelector('[data-pdf-drop]');if(!zone)return;
  zone.querySelector('input')?.remove();
  zone.insertAdjacentHTML('beforeend',`<button type="button" class="secondary" data-reference-pdf="${esc(zone.dataset.pdfDrop)}">基準パス内のPDFを選択</button>`);
  zone.querySelector('span').textContent='PDF本体はコピーせず、基準パスからの相対パスだけを登録します';
}

function journalCard(item) {
  return `<button class="journal-card" data-journal="${esc(item.id)}"><time>${esc(dateText(item.entryDate))}</time><span><strong>${esc(item.title)}</strong><small>${esc(plain(item.excerpt || ""))}</small></span><span>→</span></button>`;
}

function dashboardView() {
  const now = new Date();
  const recent = state.journals.filter(visibleByTags).slice(0, 5);
  const libraries = state.homeLibrary.filter(visibleByTags);
  const count = (type) => libraries.filter((item) => item.itemType === type).length;
  const read = (type) => libraries.filter((item) => item.itemType === type && ["read", "cited"].includes(item.status)).length;
  const colors = { ...defaultBatteryColors, ...(state.bootstrap?.batteryColors || {}) };
  const metrics = [
    ["goals", "今週のアクション", state.recentActions.filter(visibleByTags).length, "件"],
    ["files", "ファイル", state.fileTotal || 0, "件"],
    ["books", "書籍", read("book"), "読了 / 登録", count("book")],
    ["papers", "文書", read("paper"), "読了 / 登録", count("paper")],
  ];
  const today=localDate(),weekEnd=shiftDate(today,7);
  const dueTodos=(window.TickTockTomeTodo?.items()||[]).filter(visibleByTags).filter(item=>item.dueDate&&item.dueDate<=weekEnd).slice(0,6);
  const dueText=(date)=>{const days=Math.round((new Date(`${date}T12:00:00`)-new Date(`${today}T12:00:00`))/86400000);return days<0?`${Math.abs(days)}日超過`:days===0?'今日まで':`あと${days}日`;};
  const weekday = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"][now.getDay()];
  const weekdayJa = "日月火水木金土"[now.getDay()];
  const actions = state.todayActions.filter(visibleByTags).slice(0, 5);
  let cardIndex = 5;
  const card = (number, title, action, body, extra = "") => `<section class="home-card ${extra}" style="--i:${cardIndex++}"><header><div><span>${number}</span><h2>${title}</h2></div>${action}</header>${body}</section>`;
  // ページに入ったときだけ、要素が順に浮かび上がり数値が増える演出を付ける（再描画では繰り返さない）。
  return `<div class="home ${state.viewEntered ? "home-intro" : ""}"><header class="home-hero" style="--i:0"><div><p class="eyebrow">PERSONAL LOCAL ARCHIVE · ${weekday}</p><h1>HOME</h1><p>${now.getMonth() + 1}月${now.getDate()}日（${weekdayJa}）。やることと記録を、ここから。</p></div><div class="home-date" aria-label="今日の日付"><strong>${now.getDate()}</strong><span>${now.getFullYear()}<br>${String(now.getMonth() + 1).padStart(2, "0")}</span></div></header>
  <div class="home-metrics">${metrics.map(([view, label, value, unit, total], index) => `<button type="button" class="home-metric" data-view="${view}" style="--metric:${esc(colors[view])};--i:${index + 1}"><span><i></i>${esc(label)}</span><strong><b data-count="${Number(value) || 0}">${state.viewEntered ? 0 : Number(value) || 0}</b>${total === undefined ? "" : `<small>/${Number(total) || 0}</small>`}</strong><small>${esc(unit)}</small></button>`).join("")}</div>
  <div class="home-bento">
    ${card("01", "期限が近いTodo", '<button class="home-link" data-view="todo">Todoへ</button>', `<div class="home-todo-list">${dueTodos.length?dueTodos.map(item=>`<button data-view="todo" class="${item.dueDate<today?'is-overdue':''}"><span><strong>${esc(item.title)}</strong><small>${esc(item.dueDate)} · 達成 ${item.progress}%</small></span><b>${esc(dueText(item.dueDate))}</b></button>`).join(''):'<p class="home-empty">1週間以内のTodoはありません。</p>'}</div>`, "home-card-todo")}
    ${card("02", "今日の時間割", '<button class="home-link" data-view="goals">時間割へ</button>', `<div class="home-schedule">${actions.length ? actions.map((item) => `<button data-action-edit="${esc(item.id)}"><time>${esc(item.startTime)}<small>${esc(item.endTime)}</small></time><span><strong>${esc(item.action)}</strong><small>${esc(item.location || "場所未設定")}</small></span><b>${item.progress}%</b></button>`).join("") : '<p class="home-empty">今日の時間割はまだありません。</p>'}</div>`, "home-card-schedule")}
    ${card("03", "最近の記録", '<button class="home-link" data-view="analysis">活動分析へ</button>', `<div class="journal-list">${recent.length ? recent.map(journalCard).join("") : '<p class="home-empty">アクションを実行すると、自動集計が表示されます。</p>'}</div>`, "home-card-recent")}
  </div></div>`;
}

const minutesBetween=(start,end)=>{const value=timeMinutes(end)-timeMinutes(start);return Number.isFinite(value)&&value>0?value:0;};
const minuteLabel=value=>value>=60?`${Math.floor(value/60)}時間${value%60?`${value%60}分`:''}`:`${value}分`;
function analysisView(){
  const date=state.analysisDate,actions=state.recordActions.filter(item=>item.actionDate===date&&visibleByTags(item));
  const planned=actions.reduce((sum,item)=>sum+minutesBetween(item.startTime,item.endTime),0);
  const actualMinutes=item=>item.actualStartTime&&item.actualEndTime?minutesBetween(item.actualStartTime,item.actualEndTime):0;
  const actual=actions.reduce((sum,item)=>sum+actualMinutes(item),0),completed=actions.filter(item=>item.executionStatus==='completed').length,skipped=actions.filter(item=>item.executionStatus==='skipped').length;
  const rate=actions.length?Math.round(completed/actions.length*100):0,tags=new Map(state.bootstrap.tags.map(tag=>[tag.id,tag.name])),tagMinutes=new Map();
  actions.forEach(item=>item.tagIds.forEach(id=>tagMinutes.set(id,(tagMinutes.get(id)||0)+actualMinutes(item))));
  const tagRows=[...tagMinutes].sort((a,b)=>b[1]-a[1]),maxTag=Math.max(1,...tagRows.map(row=>row[1]));
  const weekDates=Array.from({length:7},(_,index)=>shiftDate(date,index-6)),week=weekDates.map(day=>({day,minutes:state.recordActions.filter(item=>item.actionDate===day).reduce((sum,item)=>sum+actualMinutes(item),0)})),maxWeek=Math.max(1,...week.map(item=>item.minutes));
  const insights=[];if(!actions.length)insights.push('この日は時間割のアクションがありません。');else{if(actual>planned)insights.push(`実績時間は予定より${minuteLabel(actual-planned)}長くなりました。`);if(planned>actual&&completed)insights.push(`実績時間は予定より${minuteLabel(planned-actual)}短く収まりました。`);if(skipped)insights.push(`${skipped}件の予定が未実施でした。`);if(rate===100)insights.push('予定したアクションをすべて完了しました。');if(tagRows[0])insights.push(`最も時間を使ったタグは「${tags.get(tagRows[0][0])||tagRows[0][0]}」です。`);}
  const llm=state.analysis?.llmSummary?`<section class="analysis-llm"><header><div><span>LOCAL LLM</span><h2>詳細分析</h2></div><button data-run-analysis>再分析する</button></header><p>${esc(state.analysis.llmSummary)}</p>${(state.analysis.llmInsights||[]).map(value=>`<div class="analysis-note">${esc(value)}</div>`).join('')}${(state.analysis.llmSuggestions||[]).length?`<div class="analysis-suggestions"><h3>次のアクション候補</h3>${state.analysis.llmSuggestions.map(value=>`<div><span>${esc(value)}</span><button data-analysis-suggestion="${esc(value)}">Todoへ追加</button></div>`).join('')}</div>`:''}</section>`:`<section class="analysis-llm empty"><div><span>LOCAL LLM</span><h2>詳細分析</h2><p>${state.bootstrap.localLlm?.enabled?'設定済みのローカルLLMで、記録の解釈と次の行動案を作れます。':'ローカルLLMが未設定でも、上の自動集計は利用できます。'}</p></div><button data-run-analysis ${state.bootstrap.localLlm?.enabled?'':'disabled'}>LLMで分析</button></section>`;
  return `${heading('ACTIVITY INSIGHTS','活動分析','記録済みデータから、時間の使い方と次の行動を考える',`<div class="analysis-date-switch"><button data-analysis-day="-1">←</button><input type="date" data-analysis-date value="${esc(date)}"><button data-analysis-day="1">→</button></div>`)}<div class="analysis-summary"><article><span>予定時間</span><strong>${minuteLabel(planned)}</strong></article><article><span>実績時間</span><strong>${minuteLabel(actual)}</strong></article><article><span>完了率</span><strong>${rate}%</strong></article><article><span>未実施</span><strong>${skipped}件</strong></article></div><div class="analysis-grid"><section><h2>直近7日間の実績</h2><div class="analysis-week">${week.map(item=>`<div><i style="height:${Math.max(3,item.minutes/maxWeek*100)}%"></i><strong>${item.minutes?minuteLabel(item.minutes):'0'}</strong><small>${item.day.slice(5).replace('-','/')}</small></div>`).join('')}</div></section><section><h2>タグ別の実績時間</h2><div class="analysis-tags">${tagRows.length?tagRows.map(([id,value])=>`<div><span>${esc(tags.get(id)||id)}</span><i><b style="width:${value/maxTag*100}%"></b></i><strong>${minuteLabel(value)}</strong></div>`).join(''):'<p class="muted">実績時間のあるタグはありません。</p>'}</div></section></div><section class="analysis-insights"><h2>自動で見つけたこと</h2>${insights.map(value=>`<p>${esc(value)}</p>`).join('')}</section>${llm}`;
}

const timeMinutes = (value) => { const [hour, minute] = String(value || "00:00").split(":").map(Number); return hour * 60 + minute; };
function clockTracks(items) {
  const usable = items.filter((item) => item.action && item.startTime && item.endTime && item.startTime < item.endTime);
  return usable.length ? usable.map((item) => { const start = timeMinutes(item.startTime), end = timeMinutes(item.endTime); return `<div class="goal-clock-track"><span style="left:${(start / 1440) * 100}%;width:${Math.max(1.8, ((end - start) / 1440) * 100)}%" title="${esc(`${item.startTime}–${item.endTime} ${item.action}`)}">${esc(item.action)}</span></div>`; }).join("") : '<div class="goal-clock-empty">時間とアクションを入力すると、ここに表示されます</div>';
}

function actionFileBrowserContent(selectedIds = []) {
  const query = state.actionFileQuery.trim().toLocaleLowerCase("ja");
  const timestamp = (item) => item.indexedAt || item.modifiedAt || "";
  const files = state.goalFiles.filter((item) => item.sourceType === 'managed' && (!state.actionTagId || item.tagIds.includes(state.actionTagId))).filter(visibleByTags).filter((item) => !query || `${item.name} ${item.relativePath}`.toLocaleLowerCase("ja").includes(query)).sort((a, b) => state.actionFileSort === "name" ? a.name.localeCompare(b.name, "ja") : timestamp(b).localeCompare(timestamp(a)) || a.name.localeCompare(b.name, "ja"));
  const folders = new Map();
  for (const file of files) { const folder = file.relativePath.split("/").slice(0, -1).join("/") || "基準フォルダ直下"; if (!folders.has(folder)) folders.set(folder, []); folders.get(folder).push(file); }
  return [...folders].map(([folder, entries]) => `<div class="action-file-folder"><h5><span>▱ ${esc(folder)}</span><small>${entries.length}件</small></h5><div>${entries.map((entry) => `<label class="goal-link"><input type="checkbox" name="managedFileIds" value="${esc(entry.id)}" ${selectedIds.includes(entry.id) ? "checked" : ""}><span><strong>${esc(entry.name)}</strong><small>${esc(entry.relativePath)}</small></span></label>`).join("")}</div></div>`).join("") || '<p class="muted action-file-empty">該当するファイルはありません。</p>';
}

// 添付フォルダ。クリックするとOSのファイル管理アプリ（Finder・エクスプローラー）で開く。Todo画面と同じ見た目。
function folderChips(paths, removeAttribute) {
  return paths.length ? `<ul class="folder-chip-list" data-no-translate>${paths.map((folder) => `<li class="folder-chip"><button type="button" data-open-folder="${esc(folder)}" title="${esc(folder)}"><span aria-hidden="true">▱</span><strong>${esc(folder.split("/").at(-1))}</strong><small>${esc(folder.split("/").slice(0, -1).join("/"))}</small></button><button type="button" class="folder-chip-remove" ${removeAttribute}="${esc(folder)}" aria-label="添付を外す" title="添付を外す">×</button><input type="hidden" name="folderPaths" value="${esc(folder)}"></li>`).join("")}</ul>` : '<p class="muted folder-chip-empty">添付したフォルダはありません。</p>';
}
window.tickTockTomeFolderChips = folderChips;

function actionFormMarkup(item) {
  const tagGroups = state.bootstrap.tagCategories.map((category) => { const tags = state.bootstrap.tags.filter((tag) => tag.categoryId === category.id); return tags.length ? `<div class="goal-tag-group"><strong>${esc(category.name)}</strong>${tags.map((tag) => `<label class="goal-tag"><input type="checkbox" name="tagIds" value="${esc(tag.id)}" ${(item.tagIds || []).includes(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("")}</div>` : ""; }).join("");
  const resource=(type,title)=>`<section class="action-resource-section"><header><div><h4>${title}</h4><small>登録済みから選択</small></div><button type="button" class="secondary" data-action-add-library="${type}">＋ この場で追加</button></header><input type="search" data-action-library-search="${type}" placeholder="題名・著者で検索" value="${esc(state.actionResourceQueries[type]||'')}"><div class="goal-link-list" data-resource-list="${type}"></div></section>`;
  return `<form class="goal-action-card action-drawer-form" data-action-form data-action-date="${esc(item.actionDate || state.goalDate)}" ${item.id ? `data-action-id="${esc(item.id)}" data-revision="${item.revision}"` : ""}><div class="goal-time-fields"><label><span>開始時間</span><input type="time" name="startTime" required value="${esc(item.startTime || "09:00")}"></label><label><span>終了時間</span><input type="time" name="endTime" required value="${esc(item.endTime || "10:00")}"></label></div><label class="goal-field"><span>アクション</span><input name="action" required maxlength="300" value="${esc(item.action || "")}" placeholder="今日やること"></label><div class="goal-two-fields"><label class="goal-field"><span>場所</span><input name="location" maxlength="300" value="${esc(item.location || "")}" placeholder="自宅、研究室など"></label><label class="goal-field"><span>達成度</span><select name="progress">${[0,25,50,75,100].map((value) => `<option value="${value}" ${Number(item.progress || 0) === value ? "selected" : ""}>${value}%</option>`).join("")}</select></label></div><fieldset class="goal-tags"><legend>タグ</legend>${tagGroups || '<span class="muted">設定画面でタグを追加できます</span>'}</fieldset><div class="resource-tag-filter">共通タグ絞り込み<select data-action-resource-tag><option value="">すべてのタグ</option>${state.bootstrap.tags.map(t=>`<option value="${esc(t.id)}" ${state.actionTagId===t.id?'selected':''}>${esc(t.categoryName)}｜${esc(t.name)}</option>`).join('')}</select></div><section class="action-resource-section"><header><div><h4>ファイル</h4><small>基準パス内から選択</small></div><button type="button" class="secondary" data-action-add-file>＋ この場で追加</button></header><div class="action-file-toolbar"><input type="search" data-action-file-search placeholder="名前・フォルダで検索" value="${esc(state.actionFileQuery)}"><select data-action-file-sort><option value="latest" ${state.actionFileSort === "latest" ? "selected" : ""}>最新順</option><option value="name" ${state.actionFileSort === "name" ? "selected" : ""}>名前順</option></select></div><div class="action-file-browser-host">${actionFileBrowserContent(item.managedFileIds || [])}</div></section><section class="action-resource-section"><header><div><h4>フォルダ</h4><small>クリックでファイル管理アプリが開きます</small></div><button type="button" class="secondary" data-action-add-folder>＋ フォルダを添付</button></header>${folderChips(item.folderPaths || [], "data-action-remove-folder")}</section>${resource('book','書籍')}${resource('paper','文書')}<label class="goal-field"><span>完了したこと（1行に1件）</span><textarea name="completions" rows="3">${esc((item.completions || []).join("\n"))}</textarea></label><div class="goal-actions">${item.id ? `<button type="button" class="danger" data-action-delete="${esc(item.id)}" data-revision="${item.revision}">削除</button>` : '<button type="button" class="secondary" data-close>キャンセル</button>'}<button type="submit" class="primary">保存</button></div></form>`;
}
function actionForm(item) { return actionFormMarkup(item).replace("完了したこと（1行に1件）","メモ（1行に1件）"); }

function actionRow(item) {
  return `<button type="button" class="goal-compact-row" data-action-edit="${esc(item.id)}"><time><span>開始</span>${esc(item.startTime)}</time><time><span>終了</span>${esc(item.endTime)}</time><strong><span>アクション</span>${esc(item.action)}</strong><span><small>場所</small>${esc(item.location || "未設定")}</span><b><small>達成度</small>${Number(item.progress || 0)}%</b></button>`;
}

function goalsView() {
  const entries = state.dailyActions;
  const dateLabel = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${state.goalDate}T12:00:00`));
  const dayName = state.goalDate === localDate() ? "今日" : state.goalDate === shiftDate(localDate(), -1) ? "昨日" : state.goalDate === shiftDate(localDate(), 1) ? "明日" : dateLabel;
  return `${heading("DAILY PLAN", "時間割", "時間ごとの予定と、達成したことを記録")}<div class="goal-date-switch"><button data-goal-day="-1">← 昨日</button><div><strong>${esc(dayName)}</strong><span>${esc(dateLabel)}</span></div><button data-goal-day="1">明日 →</button></div><section class="goal-clock"><div class="goal-clock-hours">${[0,3,6,9,12,15,18,21,24].map((hour) => `<span>${String(hour).padStart(2, "0")}</span>`).join("")}</div><div id="goalClockTracks">${clockTracks(entries)}</div></section><div class="goal-compact-list">${entries.length ? entries.filter(visibleByTags).map(actionRow).join("") : '<p class="empty-copy">この日のアクションはまだありません。</p>'}<button type="button" class="goal-list-add" data-action-add>＋ アクションを追加</button></div>`;
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const tagColor = (categoryId) => { const index = Math.max(0, state.bootstrap.tagCategories.findIndex((item) => item.id === categoryId)); return ["#477b70", "#c75543", "#9b7432", "#5c668f", "#7b587d", "#416b7c"][index % 6]; };

function calendarView() {
  const actionHtml = (item) => {const status={planned:'予定',in_progress:'実行中',completed:'完了',skipped:'未実施'}[item.executionStatus]||'予定',actual=item.actualStartTime?` · 実績 ${item.actualStartTime}${item.actualEndTime?`–${item.actualEndTime}`:''}`:'';return `<button type="button" class="calendar-action" draggable="true" data-calendar-action="${esc(item.id)}" data-action-edit="${esc(item.id)}"><small>${esc(item.startTime)} · ${esc(status)}${esc(actual)}</small>${esc(item.action)}</button>`;};
  const todoHtml = (item) => { const days=Math.round((new Date(`${item.dueDate}T12:00:00`)-new Date(`${localDate()}T12:00:00`))/86400000); const label=days<0?`${Math.abs(days)}日超過`:days===0?'今日まで':`あと${days}日`; return `<button type="button" class="calendar-todo" data-view="todo"><small>TODO · ${esc(label)}</small>${esc(item.title)}</button>`; };
  const eventHtml = (item) => item.eventType === "memo"
    ? `<button class="calendar-event" style="--activity-color:#9b7432" data-open-memo="${esc(item.id)}"><small>メモ · ${esc(item.occurredAt.slice(11, 16))}</small>${esc(item.title)}</button>`
    : `<button class="calendar-event" style="--activity-color:${item.eventType === "journal" ? "#e3654f" : "#416b7c"}" ${item.eventType === "journal" ? `data-journal="${esc(item.id)}"` : ""}><small>${item.eventType === "journal" ? "日記" : item.occurredAt.slice(11, 16)}</small>${esc(item.title)}</button>`;
  const mode = `<div class="calendar-mode"><button data-calendar-mode="month" class="${state.calendarMode === "month" ? "active" : ""}">月</button><button data-calendar-mode="week" class="${state.calendarMode === "week" ? "active" : ""}">週</button><button data-calendar-mode="day" class="${state.calendarMode === "day" ? "active" : ""}">日</button></div>`;
  if(state.calendarMode==='day'){
    const date=state.calendarDay,events=state.calendar.filter(item=>item.occurredAt.slice(0,10)===date&&visibleByTags(item)),actions=state.calendarActions.filter(item=>item.actionDate===date&&visibleByTags(item)),todos=state.calendarTodos.filter(item=>item.dueDate===date&&visibleByTags(item));
    const rows=[...todos.map(todoHtml),...actions.map(actionHtml),...events.map(eventHtml)].join('');
    const switcher=`<div class="calendar-switcher"><button data-calendar-day="-1">← 前日</button><strong>${esc(dateText(date,true))}</strong><button data-calendar-day="today">本日</button><button data-calendar-day="1">翌日 →</button>${mode}</div>`;
    return `${heading('CALENDAR VIEW','カレンダー','1日の予定・実績・Todo・日記をまとめて確認',switcher)}<div class="calendar-day-detail" data-calendar-date="${esc(date)}"><header><div><span>DAY VIEW</span><h2>${esc(date)}</h2><p>予定 ${actions.length}件 · Todo ${todos.length}件 · 記録 ${events.length}件</p></div><button class="new-button" data-record-add="${esc(date)}">＋ 記録を追加</button></header><div>${rows||'<p class="empty-copy">この日の項目はありません。</p>'}</div></div>`;
  }
  if (state.calendarMode === "week") {
    const base = new Date(state.weekDate); base.setHours(12, 0, 0, 0); base.setDate(base.getDate() - ((base.getDay() + 6) % 7));
    const dates = Array.from({ length: 7 }, (_, index) => { const day = new Date(base); day.setDate(base.getDate() + index); return localDate(day); });
    const switcher = `<div class="calendar-switcher"><button data-calendar-shift="-7">← 前週</button><strong>${dates[0].slice(5).replace("-", "/")}–${dates[6].slice(5).replace("-", "/")}</strong><button data-calendar-shift="7">次週 →</button>${mode}</div>`;
    const columns = dates.map((date, index) => { const events = state.calendar.filter((item) => item.occurredAt.slice(0, 10) === date && visibleByTags(item)); const actions = state.calendarActions.filter((item) => item.actionDate === date && visibleByTags(item)); const todos=state.calendarTodos.filter(item=>item.dueDate===date&&visibleByTags(item)); return `<section class="week-day ${date === localDate() ? "latest" : ""}" data-calendar-date="${date}"><header><span>${["月","火","水","木","金","土","日"][index]}</span><button data-calendar-open-day="${date}">${Number(date.slice(8))}</button></header><div>${todos.map(todoHtml).join("")}${actions.map(actionHtml).join("")}${events.map(eventHtml).join("")}</div></section>`; }).join("");
    return `${heading("CALENDAR VIEW", "カレンダー", "時間割をドラッグして日付を変更できます", switcher)}<div class="week-grid">${columns}</div>`;
  }
  const year = state.month.getFullYear(), month = state.month.getMonth();
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0), cells = [];
  for (let index = 0; index < first.getDay(); index += 1) cells.push('<div class="calendar-day"></div>');
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const items = state.calendar.filter((item) => item.occurredAt.slice(0, 10) === date && visibleByTags(item));
    const actions = state.calendarActions.filter((item) => item.actionDate === date && visibleByTags(item));
    const todos=state.calendarTodos.filter(item=>item.dueDate===date&&visibleByTags(item));
    cells.push(`<div class="calendar-day ${date === localDate() ? "latest" : ""}" data-calendar-date="${date}"><button class="day-number" data-calendar-open-day="${date}">${day}</button>${todos.map(todoHtml).join("")}${actions.map(actionHtml).join("")}${items.map(eventHtml).join("")}</div>`);
  }
  const switcher = `<div class="calendar-switcher"><button data-month="-1">←</button><strong>${year}年 ${month + 1}月</strong><button data-month="1">→</button>${mode}</div>`;
  return `${heading("CALENDAR VIEW", "カレンダー", "時間割をドラッグして日付を変更できます", switcher)}<div class="legend"><span><i class="kind-dot" style="--activity-color:var(--coral)"></i>時間割</span><span>日記・作業履歴</span></div><div class="calendar-grid">${["日", "月", "火", "水", "木", "金", "土"].map((day) => `<div class="weekday">${day}</div>`).join("")}${cells.join("")}</div>`;
}

function tagFilterPanel() {
  const groups = state.bootstrap.tagCategories.map((category) => ({ ...category, tags: state.bootstrap.tags.filter((tag) => tag.categoryId === category.id) })).filter((group) => group.tags.length);
  return `<div class="graph-filter"><div class="filter-title"><div><span>BRANCH FILTER</span><strong>表示するタグ</strong></div><button data-graph-all>すべて切替</button></div><div class="filter-groups">${groups.map((group) => `<fieldset class="filter-group" style="--category:${tagColor(group.id)}"><legend><span>${esc(group.name)}<small>${group.tags.filter((tag) => state.graphTags.has(tag.id)).length}/${group.tags.length}</small></span><button type="button" data-graph-category="${esc(group.id)}">切替</button></legend><div>${group.tags.map((tag) => `<label><input type="checkbox" data-graph-tag="${esc(tag.id)}" ${state.graphTags.has(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("")}</div></fieldset>`).join("")}</div></div>`;
}

function workTreeView() {
  const lanes = state.bootstrap.tags.filter((tag) => state.graphTags.has(tag.id));
  const groups = state.bootstrap.tagCategories.map((category) => ({ ...category, tags: lanes.filter((tag) => tag.categoryId === category.id) })).filter((group) => group.tags.length);
  const rows = state.workTree.filter((item) => visibleByTags(item) && item.tagIds.some((id) => state.graphTags.has(id)));
  const ranges = lanes.map((tag) => { const points = rows.map((item, index) => item.tagIds.includes(tag.id) ? index : -1).filter((index) => index >= 0); return { first: points[0] ?? -1, last: points.at(-1) ?? -1 }; });
  const bands = groups.map((group) => `<div class="category-band" style="--category:${tagColor(group.id)};grid-column:span ${group.tags.length}"><span>${esc(group.name)}</span><small>${esc(group.id)}</small></div>`).join("");
  const header = `<div class="graph-header"><div class="graph-label"><span class="timeline-mark">LATEST</span><i></i><span class="timeline-mark">PAST</span></div><div><div class="category-grid" style="grid-template-columns:repeat(${lanes.length},58px)">${bands}</div><div class="lane-grid" style="grid-template-columns:repeat(${lanes.length},58px)">${lanes.map((tag) => `<div class="lane-name" style="--category:${tagColor(tag.categoryId)}"><span>${esc(tag.name)}</span></div>`).join("")}</div></div></div>`;
  const body = rows.map((item, rowIndex) => `<button class="graph-row" data-action-edit="${esc(item.id)}"><span class="graph-label"><time>${esc(dateText(item.actionDate))}</time><span><strong>${esc(item.action)}</strong><small>${esc(item.startTime)}–${esc(item.endTime)} · ${item.tagIds.filter((id) => state.graphTags.has(id)).length} TAGS</small></span></span><span class="lane-grid" style="grid-template-columns:repeat(${lanes.length},58px)">${lanes.map((tag, index) => { const active = item.tagIds.includes(tag.id); const continued = ranges[index].first <= rowIndex && rowIndex <= ranges[index].last; return `<i class="lane-cell ${continued ? "continued" : ""} ${active ? "active" : ""}" style="--category:${tagColor(tag.categoryId)}">${active ? "<b><span></span></b>" : ""}</i>`; }).join("")}</span></button>`).join("");
  const graph = !lanes.length ? '<div class="graph-empty"><div><strong>表示するタグを選択してください</strong><p>上の分類・タグから枝を追加できます。</p></div></div>' : !rows.length ? '<div class="graph-empty"><div><strong>選択したタグを持つ時間割がありません</strong><p>時間割の編集画面でタグを付けると、ここに枝が表示されます。</p></div></div>' : `<div class="graph-scroll"><div class="graph-table" style="min-width:${390 + lanes.length * 58}px">${header}${body}</div></div><p class="graph-help">各縦線は、同じタグを持つ過去のアクションから次のアクションへのつながりを表します。</p>`;
  return `${heading("TAG CONNECTION MAP", "作業ツリー", "タグごとに時間割のアクションを管理", `<div class="graph-count"><strong>${lanes.length}</strong><span>ACTIVE<br>BRANCHES</span></div>`)}${tagFilterPanel()}${graph}`;
}

function searchView() {
  const q = state.query.trim();
  const section = (title, items, renderItem) => { const visible = items.filter(visibleByTags); return `<section class="result-section"><h2>${title} <span class="result-count">${visible.length}件</span></h2>${visible.length ? visible.map(renderItem).join("") : '<p class="empty-copy">一致する項目はありません。</p>'}</section>`; };
  if (!q) return `${heading("FULL TEXT SEARCH", "検索", "上の検索欄へキーワードを入力してください")}<div class="journal-empty"><strong>日記・作業履歴・ファイルをまとめて検索</strong><p>検索内容は外部へ送信されません。</p></div>`;
  return `${heading("FULL TEXT SEARCH", `「${q}」の検索結果`)}${section("日記", state.search.journals, journalCard)}${section("メモ", state.search.memos || [], (item) => `<button class="journal-card" data-open-memo="${esc(item.id)}"><time>${esc(dateText(localDate(new Date(item.createdAt))))}</time><span><strong>${esc(item.title)}</strong><small>${esc(item.excerpt || "")}</small></span><span>→</span></button>`)}${section("作業履歴", state.search.activities, (item) => `<div class="simple-row"><span><strong>${esc(item.windowTitle || item.applicationName)}</strong><small>${esc([item.applicationName, item.projectName].filter(Boolean).join(" · "))}</small></span><time>${esc(item.occurredAt.slice(0, 10))}</time></div>`)}${section("ファイル", state.search.files, (item) => `<button class="simple-row" data-file="${esc(item.id)}"><span><strong>${esc(item.name)}</strong><small>${esc(fileKind(item.extension))}</small></span><span>詳細 →</span></button>`)}${section("書籍・文書", state.search.library || [], (item) => `<button class="simple-row" data-library="${esc(item.id)}"><span><strong>${item.favorite ? "★ " : ""}${esc(item.title)}</strong><small>${esc((item.authors || []).join(", "))}</small></span><span>${esc({book:"書籍",paper:"文書"}[item.itemType] || "資料")} →</span></button>`)}`;
}

function fileKind(extension = "") {
  const value = String(extension).replace(/^\./, "").toLowerCase();
  if (value === "pdf") return "PDF";
  if (["doc", "docx", "odt"].includes(value)) return "文書";
  if (["xls", "xlsx", "csv"].includes(value)) return "表計算";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic"].includes(value)) return "画像";
  if (["md", "txt", "tex"].includes(value)) return "テキスト";
  return value ? value.toUpperCase() : "ファイル";
}

function filesView() {
  const tags = new Map(state.bootstrap.tags.map((tag) => [tag.id, tag.name]));
  const query = state.fileQuery.trim().toLocaleLowerCase("ja");
  const searchable = (item) => `${item.name} ${item.relativePath || ""} ${(item.actions || []).map((entry) => entry.title).join(" ")} ${(item.todos || []).map((entry) => entry.title).join(" ")} ${(item.memos || []).map((entry) => entry.title).join(" ")} ${(item.tagIds || []).map((id) => tags.get(id) || id).join(" ")}`.toLocaleLowerCase("ja");
  const visibleFiles = state.files.filter((item) => item.sourceType === "managed").filter(visibleByTags).filter((item) => [...state.fileTagIds].every(tagId=>item.tagIds.includes(tagId)) && (!query || searchable(item).includes(query))).sort((a, b) => state.fileSort === "latest" ? String(b.createdAt || "").localeCompare(String(a.createdAt || "")) : state.fileSort === "type" ? fileKind(a.extension).localeCompare(fileKind(b.extension), "ja") || a.name.localeCompare(b.name, "ja") : a.name.localeCompare(b.name, "ja"));
  const cards = visibleFiles.map((item) => `<article class="managed-file-card"><button class="managed-file-main" data-file="${esc(item.id)}"><span class="managed-file-icon"><b>${esc((item.extension || "FILE").slice(0, 4).toUpperCase())}</b></span><span><strong>${esc(item.name)}</strong><small>${esc(fileKind(item.extension))} · ${esc(item.relativePath || "")}</small><span class="managed-file-tags">${item.tagIds.length ? item.tagIds.map((id) => `<i>${esc(tags.get(id) || id)}</i>`).join("") : "タグなし"}</span></span></button>${item.actions?.length ? `<div class="managed-file-relations"><span>関連するアクション</span>${item.actions.map((action) => `<button data-action-edit="${esc(action.id)}"><time>${esc(action.itemDate || "")}</time>${esc(action.title)}</button>`).join("")}</div>` : ""}${item.todos?.length ? `<div class="managed-file-relations"><span>関連するTodo</span>${item.todos.map((todo) => `<button data-view="todo"><time>${esc(todo.itemDate || "")}</time>${esc(todo.title)}</button>`).join("")}</div>` : ""}${item.memos?.length ? `<div class="managed-file-relations"><span>関連するメモ</span>${item.memos.map((memo) => `<button data-open-memo="${esc(memo.id)}"><time>${esc(memo.itemDate || "")}</time>${esc(memo.title)}</button>`).join("")}</div>` : ""}</article>`).join("");
  return `${heading("MANAGED FILES", "ファイル", "Todo・時間割へ添付したファイルを、名前・タグ・関連する作業から検索")}<div class="file-list-toolbar"><input type="search" data-file-query value="${esc(state.fileQuery)}" placeholder="ファイル名・タグ・関連する作業で検索"><select data-file-sort><option value="name" ${state.fileSort === "name" ? "selected" : ""}>名前順</option><option value="type" ${state.fileSort === "type" ? "selected" : ""}>種類順</option><option value="latest" ${state.fileSort === "latest" ? "selected" : ""}>登録が新しい順</option></select><div class="paper-count file-count"><strong>${visibleFiles.length}</strong><span>VISIBLE<br>FILES</span></div><fieldset class="file-tag-filter"><legend>タグをすべて含むファイル（AND検索）</legend>${state.bootstrap.tagCategories.map(category=>{const categoryTags=state.bootstrap.tags.filter(tag=>tag.categoryId===category.id);return categoryTags.length?`<div><strong>${esc(category.name)}</strong>${categoryTags.map(tag=>`<label><input type="checkbox" data-file-filter-tag="${esc(tag.id)}" ${state.fileTagIds.has(tag.id)?'checked':''}><span>${esc(tag.name)}</span></label>`).join('')}</div>`:'';}).join('')}</fieldset></div><div class="managed-file-list">${cards || '<div class="journal-empty"><strong>登録されたファイルはありません</strong><p>Todoまたは時間割の編集画面からファイルを追加すると、ここで探せるようになります。</p></div>'}</div>`;
}
const libraryTypes = { book: { view: "books", title: "書籍", eyebrow: "BOOK LIBRARY", description: "一般書・小説・雑誌・教科書・参考書など" }, paper: { view: "papers", title: "文書", eyebrow: "LITERATURE SURVEY", description: "文書・PDFの書類など" } };
const readingStatuses = [{ id: "unverified", label: "未確認" }, { id: "unread", label: "未読" }, { id: "reading", label: "読書中" }, { id: "read", label: "読了" }, { id: "cited", label: "参照済み" }];

const librarySortOptions = {
  book: [["recommended","おすすめ順"],["title","タイトル順"],["author","著者順"],["tag","タグ順"],["status","読書状況順"],["priority","優先度が高い順"],["updated","更新が新しい順"],["created","登録が新しい順"],["created-asc","登録が古い順"]],
  paper: [["recommended","おすすめ順"],["title","タイトル順"],["author","著者順"],["year-desc","発行年が新しい順"],["year-asc","発行年が古い順"],["publication","掲載先順"],["tag","タグ順"],["status","読書状況順"],["priority","優先度が高い順"],["updated","更新が新しい順"],["created","登録が新しい順"]]
};
function filterAndSortLibrary(itemType, items, tagNames) {
  const query = (state.libraryQuery[itemType] || "").trim().toLocaleLowerCase("ja");
  const words = query.split(/[\s　]+/).filter(Boolean);
  const selectedTags = [...state.libraryTagIds[itemType]];
  const statusFilter = state.libraryStatusFilter[itemType];
  const statusLabel = (item) => readingStatuses.find((status) => status.id === item.status)?.label || item.status;
  const searchable = (item) => [item.title, ...(item.authors || []), item.publication, item.year, ...(item.keywords || []), item.doi, item.url, item.takeawayMarkdown, item.sourceRelativePath, statusLabel(item), ...(item.tagIds || []).map((id) => tagNames.get(id) || id)].filter(Boolean).join(" ").toLocaleLowerCase("ja");
  const firstTag = (item) => (item.tagIds || []).map((id) => tagNames.get(id) || id).sort((a, b) => a.localeCompare(b, "ja"))[0];
  const statusOrder = { unverified: 0, reading: 1, unread: 2, read: 3, cited: 4 };
  const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "ja");
  const compare = {
    recommended: () => 0,
    title: byTitle,
    author: (a, b) => (a.authors?.[0] ? 0 : 1) - (b.authors?.[0] ? 0 : 1) || String(a.authors?.[0] || "").localeCompare(String(b.authors?.[0] || ""), "ja") || byTitle(a, b),
    tag: (a, b) => (firstTag(a) ? 0 : 1) - (firstTag(b) ? 0 : 1) || String(firstTag(a) || "").localeCompare(String(firstTag(b) || ""), "ja") || byTitle(a, b),
    status: (a, b) => (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9) || byTitle(a, b),
    priority: (a, b) => Number(b.priority || 0) - Number(a.priority || 0) || byTitle(a, b),
    updated: (a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    created: (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    "created-asc": (a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
    "year-desc": (a, b) => (a.year ? 0 : 1) - (b.year ? 0 : 1) || Number(b.year || 0) - Number(a.year || 0) || byTitle(a, b),
    "year-asc": (a, b) => (a.year ? 0 : 1) - (b.year ? 0 : 1) || Number(a.year || 0) - Number(b.year || 0) || byTitle(a, b),
    publication: (a, b) => (a.publication ? 0 : 1) - (b.publication ? 0 : 1) || String(a.publication || "").localeCompare(String(b.publication || ""), "ja") || byTitle(a, b)
  }[state.librarySort[itemType]] || (() => 0);
  return items
    .filter((item) => selectedTags.every((tagId) => (item.tagIds || []).includes(tagId)))
    .filter((item) => !statusFilter || item.status === statusFilter)
    .filter((item) => { const text = searchable(item); return words.every((word) => text.includes(word)); })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item) || a.index - b.index)
    .map((entry) => entry.item);
}
function libraryToolbar(itemType, visibleCount, totalCount) {
  const selected = state.libraryTagIds[itemType];
  const unit = itemType === "paper" ? "PAPERS" : "BOOKS";
  const filtered = (state.libraryQuery[itemType] || "").trim() || selected.size || state.libraryStatusFilter[itemType] || state.librarySort[itemType] !== "recommended";
  const tagGroups = state.bootstrap.tagCategories.map((category) => { const categoryTags = state.bootstrap.tags.filter((tag) => tag.categoryId === category.id && !state.hiddenTagIds.has(tag.id)); return categoryTags.length ? `<div><strong>${esc(category.name)}</strong>${categoryTags.map((tag) => `<label><input type="checkbox" data-library-filter-tag="${esc(tag.id)}" data-library-type="${itemType}" ${selected.has(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("")}</div>` : ""; }).join("");
  return `<div class="file-list-toolbar library-toolbar"><input type="search" data-library-query="${itemType}" value="${esc(state.libraryQuery[itemType] || "")}" placeholder="${itemType === "paper" ? "タイトル・著者・キーワード・掲載先・DOI・タグで検索" : "タイトル・著者・タグ・メモで検索"}" aria-label="キーワード検索"><select data-library-sort="${itemType}" aria-label="並び替え">${librarySortOptions[itemType].map(([value, label]) => `<option value="${value}" ${state.librarySort[itemType] === value ? "selected" : ""}>${label}</option>`).join("")}</select><select data-library-status="${itemType}" aria-label="読書状況で絞り込み"><option value="">すべての状況</option>${readingStatuses.map((status) => `<option value="${status.id}" ${state.libraryStatusFilter[itemType] === status.id ? "selected" : ""}>${status.label}</option>`).join("")}</select><div class="paper-count file-count"><strong>${visibleCount}<small> / ${totalCount}</small></strong><span>VISIBLE<br>${unit}</span></div>${filtered ? `<button type="button" class="secondary library-filter-reset" data-library-reset="${itemType}">条件をリセット</button>` : ""}${tagGroups ? `<fieldset class="file-tag-filter"><legend>タグで絞り込み（選んだタグをすべて含むもの）</legend>${tagGroups}</fieldset>` : ""}</div>`;
}
const libraryNoMatch = (itemType) => `<div class="journal-empty"><strong>条件に一致する${itemType === "paper" ? "文書" : "書籍"}はありません</strong><p>キーワードやタグの条件を変えてみてください。</p><button type="button" class="secondary" data-library-reset="${itemType}">条件をリセット</button></div>`;

function libraryView(itemType) {
  const type = libraryTypes[itemType], tags = new Map(state.bootstrap.tags.map((tag) => [tag.id, tag]));
  state.libraryItems = state.libraryItems.filter(visibleByTags);
  const tagNames = new Map(state.bootstrap.tags.map((tag) => [tag.id, tag.name]));
  const shown = filterAndSortLibrary(itemType, state.libraryItems, tagNames);
  const toolbar = libraryToolbar(itemType, shown.length, state.libraryItems.length);
  if (itemType !== "paper") {
    const books = shown.map((item) => `<button class="book-volume ${item.status==='unverified'?'is-unverified':''}" data-library="${esc(item.id)}"><span class="book-cover">${item.coverUploadId ? `<img src="/api/v1/uploads/${esc(item.coverUploadId)}/content" alt="">` : '<b>BOOK</b>'}<i></i></span><span class="book-spine-info"><small>${item.status === "unverified" ? '<i class="unverified-dot"></i> 未確認 · 書誌情報を確認してください' : (item.favorite ? "★ FAVORITE" : "LIBRARY")}</small><strong>${esc(item.title)}</strong><span>${esc(item.authors.join(", ") || "著者未入力")}</span><span class="book-meta">${esc(readingStatuses.find((status) => status.id === item.status)?.label || item.status)} · ${esc(item.tagIds.map((id) => tags.get(id)?.name || id).join(" / ") || "タグなし")}</span></span><span class="book-arrow">詳細 →</span></button>`).join("");
    const tools = `<div class="paper-tools"><div class="paper-count"><strong>${state.libraryItems.length}</strong><span>TOTAL<br>BOOKS</span></div><button class="new-button" data-new-library="${itemType}">＋ 新規追加</button></div>`;
    return `${heading(type.eyebrow, type.title, type.description, tools)}<label class="book-pdf-drop" data-pdf-drop="${itemType}"><input type="file" accept="application/pdf" data-pdf-input="${itemType}"><strong>PDFをここへドロップ</strong><span>基準フォルダ内のPDFを「未確認」として登録します</span></label>${toolbar}<div class="book-shelf-list">${books || (state.libraryItems.length ? libraryNoMatch(itemType) : '<div class="journal-empty"><strong>本棚はまだ空です</strong><p>PDFをドロップするか、新規追加してください。</p></div>')}</div>`;
  }
  const papers = shown.map((item) => `<article class="paper-volume ${item.status==='unverified'?'is-unverified':''}" data-library="${esc(item.id)}"><span class="paper-preview">${(item.sourceRootId || item.sourceUploadId) ? `<img src="/api/v1/library/${esc(item.id)}/thumbnail" alt="${esc(item.title)}の先頭ページ" loading="lazy" decoding="async">` : '<b>PDF</b>'}<i></i></span><button type="button" class="paper-spine-info" data-library="${esc(item.id)}"><small>${item.status === "unverified" ? '<i class="unverified-dot"></i> 未確認 · 書誌情報を確認してください' : (item.favorite ? "★ FAVORITE" : "PAPER")}</small><strong>${esc(item.title)}</strong><span>${esc(item.authors.join(", ") || "著者未入力")}</span><span class="paper-meta">${esc(item.year || "年未入力")} · ${esc(item.publication || "掲載先未入力")} · ${esc(readingStatuses.find((status) => status.id === item.status)?.label || item.status)}</span><span class="paper-keywords">${esc(item.keywords.join(" / ") || "キーワードなし")} · ${esc(item.tagIds.map((id) => tags.get(id)?.name || id).join(" / ") || "タグなし")}</span></button><span class="book-arrow">詳細 →</span></article>`).join("");
  const tools = `<div class="paper-tools"><div class="paper-count"><strong>${state.libraryItems.length}</strong><span>TOTAL<br>PAPERS</span></div><button class="new-button" data-new-library="${itemType}">＋ 新規追加</button></div>`;
  return `${heading(type.eyebrow, type.title, type.description, tools)}<label class="book-pdf-drop" data-pdf-drop="paper"><input type="file" accept="application/pdf" data-pdf-input="paper"><strong>文書のPDFをここへドロップ</strong><span>基準フォルダ内のPDFを「未確認」として登録します</span></label>${toolbar}<div class="paper-shelf-list">${papers || (state.libraryItems.length ? libraryNoMatch(itemType) : '<div class="journal-empty"><strong>文書棚はまだ空です</strong><p>PDFをドロップするか、新規追加してください。</p></div>')}</div>`;
}
function settingsView() { const typeNames = { journal: "日記", memo: "メモ", book: "書籍", paper: "文書" }, theme = state.bootstrap.theme; return `${heading("SETTINGS", "設定", "アプリ内の設定")}<div class="settings-grid"><form class="settings-card theme-settings" data-theme-form><h2>配色</h2><p>背景、カードやナビゲーション、主要ボタンの色を変更できます。</p><div class="theme-fields"><label><span>背景色</span><input type="color" name="background" value="${esc(theme.background)}"></label><label><span>カード・ナビゲーション</span><input type="color" name="surface" value="${esc(theme.surface)}"></label><label><span>ボタン・強調色</span><input type="color" name="accent" value="${esc(theme.accent)}"></label></div><button class="primary" type="submit">配色を保存</button></form><section class="settings-card"><h2>タグ <button class="new-button" data-new-tag>＋ タグ</button></h2>${state.bootstrap.tags.length ? `<ul>${state.bootstrap.tags.map((tag) => `<li>${esc(tag.name)} <code>${esc(tag.id)}</code></li>`).join("")}</ul>` : '<p>タグはまだありません。</p>'}</section><section class="settings-card file-root-settings"><h2>ファイル参照の基準パス <button class="new-button" data-new-root>＋ 追加</button></h2><p>実際のパスは画面へ表示せず、利用可能かどうかだけを毎回確認します。</p>${state.bootstrap.fileRoots.length ? `<div class="root-list">${state.bootstrap.fileRoots.map((root) => `<div class="simple-row"><span><strong>${esc(root.displayName)}</strong><small><code>${esc(root.id)}</code> · <i class="root-state ${root.available ? "available" : "missing"}">${root.available ? "利用可能" : "見つかりません"}</i></small></span><button data-edit-root="${esc(root.id)}">再設定</button></div>`).join("")}</div>` : '<div class="empty-root"><strong>基準パスが未設定です</strong><p>「追加」からOSのフォルダ選択画面を開けます。</p></div>'}</section><section class="settings-card"><h2>ゴミ箱</h2><p>${state.trash.length}件あります。</p>${state.trash.map((item) => `<div class="simple-row"><span><strong>${esc(item.title)}</strong><small>${esc(typeNames[item.itemType || item.entityType] || "資料")} · ${esc(item.displayDate || "")}</small></span><span><button data-restore="${esc(item.id)}" data-trash-type="${esc(item.entityType)}" data-revision="${item.revision}">復元</button> <button data-purge="${esc(item.id)}" data-trash-type="${esc(item.entityType)}" data-revision="${item.revision}">完全削除</button></span></div>`).join("")}</section></div>`; }

function settingsViewWithReset() {
  const categoryForms = state.bootstrap.tagCategories.map((category) => `<form class="tag-admin-row category-admin-row" data-category-form data-category-id="${esc(category.id)}" data-revision="${category.revision}"><input type="number" name="displayOrder" min="1" value="${category.displayOrder}"><input name="name" value="${esc(category.name)}" required><code>${esc(category.id)}</code><input name="description" value="${esc(category.description)}"><button class="secondary">保存</button></form>`).join("");
  const tagTables = state.bootstrap.tagCategories.map((category) => { const tags = state.bootstrap.tags.filter((tag) => tag.categoryId === category.id); return `<section class="tag-category-table"><h3>${esc(category.name)} <small>${tags.length}件</small></h3><div class="tag-admin-head"><span>表示順</span><span>表示名</span><span>分類</span><span>説明</span><span>操作</span></div>${tags.map((tag) => `<form class="tag-admin-row" data-tag-form data-tag-id="${esc(tag.id)}" data-revision="${tag.revision}"><input type="number" name="displayOrder" min="1" value="${tag.displayOrder}"><input name="name" value="${esc(tag.name)}" required><select name="categoryId">${state.bootstrap.tagCategories.map((option) => `<option value="${esc(option.id)}" ${option.id === tag.categoryId ? "selected" : ""}>${esc(option.name)}</option>`).join("")}</select><input name="description" value="${esc(tag.description)}"><span class="tag-row-actions"><button class="secondary">保存</button><button type="button" class="secondary" data-tag-archive="${esc(tag.id)}" data-revision="${tag.revision}">アーカイブ</button></span></form>`).join("") || '<p class="muted">この分類のタグはありません。</p>'}</section>`; }).join("");
  const archivedTagRows=(state.bootstrap.archivedTags||[]).map(tag=>`<div class="simple-row"><span><strong>${esc(tag.name)}</strong><small>${esc(tag.categoryName)} · ${esc(tag.description||'説明なし')}</small></span><button data-tag-restore="${esc(tag.id)}" data-revision="${tag.revision}">復元</button></div>`).join('')||'<p class="muted">アーカイブ済みのタグはありません。</p>';
  const tagAdmin = `<section class="settings-card tag-management"><h2>タグ管理 <button class="new-button" data-new-tag>＋ タグ</button></h2><p>分類名・説明・表示順と、分類ごとのタグを編集できます。</p><h3>分類</h3><div class="tag-admin-head category-head"><span>表示順</span><span>表示名</span><span>内部ID</span><span>説明</span><span></span></div>${categoryForms}${tagTables}</section>`;
  return settingsView()
    .replace('<button class="primary" type="submit">配色を保存</button>', '<div class="theme-actions"><button class="secondary" type="button" data-theme-reset>初期配色に戻す</button><button class="primary" type="submit">配色を保存</button></div>')
    .replace(/<section class="settings-card"><h2>タグ .*?<\/section>/, tagAdmin);
}

const themePresets = {
  light: { background: "#f4f1ea", surface: "#eeebe4", accent: "#e3654f", text: "#22282d" },
  night: { background: "#171b20", surface: "#222830", accent: "#f29b7f", text: "#edf0ec" },
  forest: { background: "#eef2e9", surface: "#dfe9dc", accent: "#477b70", text: "#24352e" },
  lavender: { background: "#f3eff7", surface: "#e8e0f0", accent: "#765477", text: "#332b38" },
  ocean: { background: "#eaf3f5", surface: "#dce9ed", accent: "#416b7c", text: "#203239" },
};
// HOMEは白、設定・使い方は無彩色、Todo〜文書はナビの並び順に虹色（scripts/settings.jsと同じ値）。
const defaultBatteryColors = {
  dashboard: "#ffffff", todo: "#e06666", goals: "#ec9a4a", calendar: "#e2c044",
  analysis: "#a3c255", worktree: "#56b27a", files: "#4db3be", books: "#5b8dd9",
  papers: "#9573cf", settings: "#96968f", help: "#96968f",
};
const characterSpeeds = [[80, "ゆっくり"], [150, "ふつう"], [240, "はやい"], [400, "とてもはやい"]];
const batteryPageLabels = {
  dashboard: "HOME", todo: "Todo", goals: "時間割", calendar: "カレンダー", analysis: "活動分析",
  worktree: "作業ツリー", files: "ファイル", books: "書籍", papers: "文書", settings: "設定", help: "使い方",
};

function settingsViewV2() {
  const theme = state.bootstrap.theme;
  const themeMode = state.bootstrap.themeMode || "auto";
  const batteryColors = { ...defaultBatteryColors, ...(state.bootstrap.batteryColors || {}) };
  const typeNames = { journal: "日記", memo: "メモ", book: "書籍", paper: "文書" };
  const tagTables = state.bootstrap.tagCategories.map((category) => { const tags = state.bootstrap.tags.filter((tag) => tag.categoryId === category.id); return `<section class="tag-category-table"><h3>${esc(category.name)} <small>${tags.length}件</small></h3><div class="tag-admin-head"><span>表示順</span><span>表示名</span><span>分類</span><span>説明</span><span>操作</span></div>${tags.map((tag) => `<form class="tag-admin-row" data-tag-form data-tag-id="${esc(tag.id)}" data-revision="${tag.revision}"><input type="number" name="displayOrder" min="1" value="${tag.displayOrder}"><input name="name" value="${esc(tag.name)}" required><select name="categoryId">${state.bootstrap.tagCategories.map((option) => `<option value="${esc(option.id)}" ${option.id === tag.categoryId ? "selected" : ""}>${esc(option.name)}</option>`).join("")}</select><input name="description" value="${esc(tag.description)}"><span class="tag-row-actions"><button class="secondary">保存</button><button type="button" class="secondary" data-tag-archive="${esc(tag.id)}" data-revision="${tag.revision}">アーカイブ</button></span></form>`).join("") || '<p class="muted">この分類のタグはありません。</p>'}</section>`; }).join("");
  const roots = window.TickTockTomeDataset.settingsCard(state.bootstrap);
  const trash = state.trash.map((item) => `<div class="simple-row"><span><strong>${esc(item.title)}</strong><small>${esc(typeNames[item.itemType || item.entityType] || "資料")} · ${esc(item.displayDate || "")}</small></span><span><button data-restore="${esc(item.id)}" data-trash-type="${esc(item.entityType)}" data-revision="${item.revision}">復元</button> <button data-purge="${esc(item.id)}" data-trash-type="${esc(item.entityType)}" data-revision="${item.revision}">完全削除</button></span></div>`).join("");
  const llm=state.bootstrap.localLlm||{enabled:false,executablePath:"",modelPath:"",pdfTextPath:""};
  const llmCard=`<form class="settings-card local-llm-settings" data-local-llm-form><h2>ローカルLLM</h2><p>書誌情報の抽出と活動分析に使用します。モデルのダウンロードや外部送信は自動で行いません。</p><ol><li>llama.cppの<code>llama-cli</code>をPCへ用意します。</li><li>利用許諾を確認したGGUFモデルを自分でダウンロードします。</li><li>PDF文字抽出用の<code>pdftotext</code>を用意します。</li><li>下の3つの絶対パスを入力して有効にします。</li></ol><label class="llm-toggle"><input type="checkbox" name="enabled" ${llm.enabled?"checked":""}><span>ローカルLLMを有効にする</span></label><label><span>活動分析の実行方法</span><select name="analysisMode"><option value="off" ${llm.analysisMode==='off'?'selected':''}>使用しない</option><option value="manual" ${llm.analysisMode==='manual'?'selected':''}>手動分析</option><option value="auto" ${llm.analysisMode==='auto'?'selected':''}>自動分析</option></select></label><div class="llm-path-grid"><label><span>llama.cpp実行ファイル</span><input name="executablePath" value="${esc(llm.executablePath)}" placeholder="/path/to/llama-cli"></label><label><span>GGUFモデル</span><input name="modelPath" value="${esc(llm.modelPath)}" placeholder="/path/to/model.gguf"></label><label><span>pdftotext実行ファイル</span><input name="pdfTextPath" value="${esc(llm.pdfTextPath)}" placeholder="/path/to/pdftotext"></label></div><p class="privacy-note">自動分析は画面表示後に直近7日間の未分析・更新済みの日だけを処理します。通常集計はLLMなしでも利用できます。</p><button class="primary">ローカルLLM設定を保存</button></form>`;
  const illumination = state.bootstrap.illumination !== false, speed = state.bootstrap.characterSpeed || 150;
  const motionCard = `<form class="settings-card motion-settings" data-motion-form><h2>アニメーション</h2><p>ナビゲーションを押したときの演出を設定します。</p><label class="llm-toggle"><input type="checkbox" name="illumination" ${illumination ? "checked" : ""}><span>豆電球と同期してページの色を切り替える</span></label><p class="privacy-note">オフにすると、ページを切り替えた瞬間にページの色も変わります。キャラクターは引き続き電池まで歩きます。</p><fieldset class="motion-speed-options"><legend>キャラクターの速さ</legend>${characterSpeeds.map(([value, label]) => `<label><input type="radio" name="characterSpeed" value="${value}" ${speed === value ? "checked" : ""}><span>${label}</span></label>`).join("")}</fieldset><button class="primary">アニメーションを保存</button></form>`;
  const fonts = [{id:"classic",name:"クラシック",sample:"記録を、静かに積み重ねる",note:"読みやすい本文＋落ち着いた見出し"},{id:"modern",name:"モダン",sample:"今日の予定を整える",note:"すっきりしたゴシック体"},{id:"rounded",name:"まるもじ",sample:"ちいさな一歩を楽しもう",note:"やさしくポップな丸ゴシック"},{id:"handwriting",name:"てがき",sample:"思いつきをそのままメモ",note:"ノートのような手書き体"},{id:"mincho",name:"明朝",sample:"日々の記憶を綴る",note:"本のような明朝体"}];
  const fontCard = `<form class="settings-card font-settings" data-font-form><h2>フォント</h2><p>アプリに同梱した書体なので、OSが変わっても同じ見た目で表示されます。</p><div class="font-preset-grid">${fonts.map((font) => `<label class="font-preset font-preview-${font.id}"><input type="radio" name="fontPreset" value="${font.id}" ${state.bootstrap.fontPreset === font.id ? "checked" : ""}><span><strong>${font.name}</strong><b>${font.sample}</b><small>${font.note}</small></span></label>`).join("")}</div><div class="font-settings-footer"><small>SIL Open Font Licenseの書体を使用しています。</small><button class="primary">フォントを保存</button></div></form>${motionCard}${llmCard}`;
  const modeChoices = `<fieldset class="theme-mode-options"><legend>ページテーマ</legend><label><input type="radio" name="themeMode" value="auto" ${themeMode === "auto" ? "checked" : ""}><span><b>自動</b><small>接続した電池の色でページを照らします</small></span></label><label><input type="radio" name="themeMode" value="manual" ${themeMode === "manual" ? "checked" : ""}><span><b>手動</b><small>すべてのページで同じ配色を使います</small></span></label></fieldset>`;
  const batteryFields = `<section class="battery-color-settings"><div class="battery-color-head"><div><h3>ページごとの配色</h3><p>選んだ色から、ナビゲーションの電池と自動テーマを生成します。</p></div><button class="secondary" type="button" data-battery-reset>既定の配色に戻す</button></div><div class="battery-color-grid">${Object.entries(batteryPageLabels).map(([view, label]) => `<label><span>${label}</span><input type="color" name="battery-${view}" value="${esc(batteryColors[view])}"></label>`).join("")}</div></section>`;
  const manualFields = `<section class="manual-theme-settings"><h3>手動モードの配色</h3><div class="theme-presets">${Object.entries({ light:"ライト", night:"ナイト", forest:"フォレスト", lavender:"ラベンダー", ocean:"オーシャン" }).map(([id, label]) => `<button type="button" data-theme-preset="${id}">${label}</button>`).join("")}</div><div class="theme-fields"><label><span>背景色</span><input type="color" name="background" value="${esc(theme.background)}"></label><label><span>カード</span><input type="color" name="surface" value="${esc(theme.surface)}"></label><label><span>強調色</span><input type="color" name="accent" value="${esc(theme.accent)}"></label><label><span>文字色</span><input type="color" name="text" value="${esc(theme.text || "#22282d")}"></label></div></section>`;
  return `${heading("SETTINGS", "設定", "アプリ内の設定")}<div class="settings-grid"><form class="settings-card theme-settings" data-theme-form data-theme-mode="${themeMode}"><h2>外見</h2><p>自動モードでは、キャラクターの豆電球が点灯するとページの色が切り替わります。</p>${modeChoices}${batteryFields}${manualFields}<div class="theme-actions"><button class="secondary" type="button" data-theme-reset>初期設定に戻す</button><button class="primary" type="submit">外見を保存</button></div></form>${fontCard}${roots}<section class="settings-card tag-management"><h2>タグ管理 <button class="new-button" data-new-tag>＋ タグ</button></h2><p>分類は「所属・テーマ・チャンネル・プロジェクト・ツール・その他」の6種類で固定されています。</p>${tagTables}</section><section class="settings-card"><h2>ゴミ箱</h2><p>${state.trash.length}件あります。</p>${trash || '<p class="muted">ゴミ箱は空です。</p>'}</section></div>`;
}

function helpView() {
  const guide = (number, image, title, lead, points = []) => `<article class="help-card"><img src="${image}" alt="${esc(title)}の操作イラスト"><div><span class="help-step">STEP ${number}</span><h2>${esc(title)}</h2><p>${esc(lead)}</p>${points.length ? `<ul>${points.map((point) => `<li>${esc(point)}</li>`).join("")}</ul>` : ""}</div></article>`;
  return `${heading("GUIDE", "使い方", "Todoから計画、実行、分析、資料整理まで")}<div class="help-intro"><strong>基本の流れ</strong><span>Todoに集める → 時間割へ取り込む → タイマーを見ながら実行 → 活動分析で気づきを得る<br>Macでは⌘＋数字、WindowsではCtrl＋数字で切り替えられます。</span></div><div class="help-list">
    ${guide("01", "/assets/help-todo.svg", "Todoへやることを集める", "思いついた作業は、まずTodoへ登録します。", ["名前、期限日、1%刻みの達成度を入力できます。", "タグは分類をまたいで複数選択できます。", "達成度100%になったTodoは通常一覧から消えますが、完了履歴は保存されます。"])}
    ${guide("02", "/assets/help-timetable.svg", "Todoから時間割を組み立てる", "時間割の「アクションを追加」を押し、新規作成またはTodoカードを選びます。", ["Todoを選ぶと、名前、タグ、達成度が引き継がれ、時間割の日付は本日になります。Todoの期限日はTodo側に保持されます。", "開始時刻は最後の予定終了後の正時に設定され、終了時刻はその1時間後になります。", "場所、メモ、ファイル、本、文書などを追加して保存します。"])}
    ${guide("03", "/assets/help-timer.svg", "タイマーを見ながら実行する", "左下には実行中または次のアクションと、終了・開始までの時間が表示されます。", ["予定時刻を過ぎただけでは実行済みになりません。開始操作をした時刻を実績として記録します。", "完了確認では実績開始・終了、達成度、メモを編集できます。", "終了済みの予定が複数ある場合は、予定順に完了・実行中・未実施を確認します。"])}
    ${guide("04", "/assets/help-calendar.svg", "カレンダーで月・週・日を見る", "Todo、時間割、日記を日付に沿って確認できます。", ["月・週・日の3種類を切り替えられます。", "日表示には、その日の予定・実績・Todo・記録をまとめます。", "時間割のアクションは別の日へドラッグして予定日を変更できます。"])}
    ${guide("05", "/assets/help-daily-record.svg", "活動分析から気づきを得る", "入力作業を増やさず、時間割と実績から自動集計します。", ["予定時間・実績時間・完了率・未実施数を表示します。", "直近7日間とタグ別の時間配分をグラフで確認できます。", "ローカルLLMを設定すると、手動または自動で詳しい分析を追加できます。"])}
    ${guide("06", "/assets/help-worktree.svg", "作業ツリーで活動の履歴をつなぐ", "同じタグが付いた時間割アクションを縦の枝としてつなぎ、活動の流れを整理します。", ["表示する分類・タグを上部で選べます。", "所属、テーマ、プロジェクト、ツールなど複数の観点を重ねられます。", "枝上のアクションを選ぶと編集画面が開きます。"])}
    ${guide("07", "/assets/help-files.svg", "関連ファイルをまとめて探す", "Todoや時間割へ添付したファイルは、自動的にファイル画面の管理対象になります。", ["ファイル名だけでなく、関連するTodo・アクションの名前やタグでも検索できます。", "検索結果から関連アクションを選ぶと、その編集画面が開きます。", "一覧表示時はファイル本体を読まないため、登録数が増えても不要な待ち時間を抑えます。"])}
    ${guide("08", "/assets/help-library.svg", "本と文書を本棚のように整理", "書籍・文書は、基準パスからの相対パスだけを登録します。", ["Todo・時間割の編集画面でも、資料の検索・タグ絞り込み・新規追加ができます。", "追加直後は赤い印の「未確認」になり、書誌情報を確認してから状態を変更します。", "ローカルLLMは初期状態では無効です。設定画面の手順を完了した場合だけPDFから書誌情報の候補を抽出します。"])}
    ${guide("09", "/assets/help-file-roots.svg", "基準パスは1か所だけ", "書籍・文書・ファイルは、すべて1つの基準パスからの相対パスで管理します。", ["DBに保存するのは基準パスからの相対パスであり、PDFや一般ファイル本体ではありません。", "基準パスの外や、外部へ出るシンボリックリンクは拒否します。", "基準パスごとフォルダを移動・同期しても、同じ相対パスで参照し続けられます。"])}
    ${guide("10", "/assets/help-storage.svg", "基準パスは1つのデータセット", "基準パス直下の隠しフォルダ「.kobito-tools」に、IDと主要データをまとめて保存します。", ["データセット：ID、配色・フォント・タグ表示の設定、SQLite、表紙画像、添付、バックアップ。", "このPCだけの設定：現在の基準パス、ポート、連携トークン、ローカルLLMの実行ファイルの場所。", "開いている間は使用中の印を置き、別のPCで同じ基準パスを同時に開かないようにします。"])}</div>`;
}

function tagVisibilityPanel() {
  if (!state.tagPanelOpen) return "";
  return `<aside class="tag-visibility-panel"><header><div><strong>表示するタグ</strong><small>OFFのタグを持つ項目は全画面で非表示</small></div><button data-tag-panel>×</button></header>${state.bootstrap.tagCategories.map((category) => { const tags = state.bootstrap.tags.filter((tag) => tag.categoryId === category.id); return tags.length ? `<section><h3>${esc(category.name)}</h3>${tags.map((tag) => `<label><input type="checkbox" data-visible-tag="${esc(tag.id)}" ${state.hiddenTagIds.has(tag.id) ? "" : "checked"}><span>${esc(tag.name)}</span></label>`).join("")}</section>` : ""; }).join("") || '<p class="muted">タグはまだありません。</p>'}</aside>`;
}


function defaultActionTimes() {
  const latest=state.dailyActions.reduce((value,item)=>Math.max(value,timeMinutes(item.endTime)),0);
  const now=new Date(),current=now.getHours()*60+now.getMinutes();
  let start=Math.ceil((latest||current)/60)*60;
  if(start>=1380)start=1320;
  const text=value=>`${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;
  return {startTime:text(start),endTime:text(start+60)};
}
function actionChoiceDrawer() {
  const todos=window.TickTockTomeTodo.items().filter(visibleByTags);
  const tags=new Map(state.bootstrap.tags.map(tag=>[tag.id,tag.name]));
  return `<div class="overlay" data-close><article class="drawer action-choice-drawer" data-drawer><button class="close" data-close>×</button><p class="eyebrow">STEP 1 / 2</p><h2>アクションの追加方法</h2><p class="authors">新しく作るか、Todoの内容を取り込んで作成します。</p><div class="action-choice-list"><button data-action-choice="new"><strong>＋ 新規作成</strong><small>空のアクションを作成します</small></button>${todos.map(todo=>`<button data-action-choice="${esc(todo.id)}"><strong>${esc(todo.title)}</strong><small>${todo.dueDate?`期限 ${esc(todo.dueDate)} · `:""}${todo.progress}% · ${esc(todo.tagIds.map(id=>tags.get(id)||id).join(" / ")||"タグなし")}</small></button>`).join("")||'<p class="empty-copy">取り込めるTodoはありません。</p>'}</div></article></div>`;
}

function drawer() {
  if (state.actionChooser) return actionChoiceDrawer();
  if (state.selectedAction) {
    const item = state.selectedAction;
    return `<div class="overlay" data-close><article class="drawer action-drawer" data-drawer><button class="close" data-close>×</button><p class="eyebrow">DAILY ACTION · ${esc(item.actionDate || state.goalDate)}</p><h2>${esc(item.id ? item.action : "アクションを追加")}</h2><p class="authors">時間・達成度・関連資料などをまとめて編集できます。</p>${actionForm(item)}</article></div>`;
  }
  if (state.selectedFile) {
    const item = state.selectedFile, tags = new Map(state.bootstrap.tags.map((tag) => [tag.id, tag.name]));
    const indexed = (item.sourceType || "index") === "index";
    const sourceName = { managed: "Tomeletの管理ファイル", index: "旧ファイル索引", journal: "日記の関連ファイル", upload: "時間割から追加したファイル" }[item.sourceType || "index"] || "関連ファイル";
    const tagEditor = indexed ? `<section><h3>タグ</h3><div class="check-groups file-tag-editor">${state.bootstrap.tags.length ? state.bootstrap.tags.map((tag) => `<label class="check-chip"><input type="checkbox" data-file-tag value="${esc(tag.id)}" ${item.tagIds.includes(tag.id) ? "checked" : ""}><span>${esc(tag.name)}</span></label>`).join("") : "タグはまだありません。"}</div><button class="secondary drawer-save" data-save-file-tags>タグを保存</button></section>` : "";
    const open = item.sourceType === "upload" ? `<a class="primary drawer-open managed-file-open" href="/api/v1/uploads/${esc(item.uploadId)}/content" target="_blank" rel="noopener noreferrer">登録したファイルを開く</a>` : `<button class="primary drawer-open" data-open-root="${esc(item.rootId)}" data-open-path="${esc(item.relativePath)}">OSの標準アプリで開く</button>`;
    return `<div class="overlay" data-close><article class="drawer" data-drawer><button class="close" data-close>×</button><p class="eyebrow">${esc(sourceName)}</p><h2>${esc(item.name)}</h2><p class="authors">${esc(fileKind(item.extension))}</p>${tagEditor}<section><h3>保存している参照情報</h3><dl><div><dt>保存元</dt><dd>${esc(sourceName)}</dd></div><div><dt>種類</dt><dd>${esc(fileKind(item.extension))}</dd></div><div><dt>タグ</dt><dd>${esc(item.tagIds.map((id) => tags.get(id) || id).join("、") || "なし")}</dd></div></dl>${item.relativePath ? `<p class="relative-path">${esc(item.relativePath)}</p>` : ""}</section>${open}<p class="privacy-note">${item.sourceType === "upload" ? "ファイル実体は共有データ保存先にあります。" : "ファイルの存在確認は、このボタンを押したときに行います。"}</p></article></div>`;
  }
  if (state.selectedLibrary) {
    const item = state.selectedLibrary, type = libraryTypes[item.itemType], tags = new Map(state.bootstrap.tags.map((tag) => [tag.id, tag]));
    const related = item.journalIds.map((id) => state.journals.find((journal) => journal.id === id)).filter(Boolean);
    const sourceFile = item.sourceRootId ? `<button class="external-link" data-open-root="${esc(item.sourceRootId)}" data-open-path="${esc(item.sourceRelativePath)}">登録したPDFを開く ↗</button>` : item.sourceUploadId ? `<a class="external-link" href="/api/v1/uploads/${esc(item.sourceUploadId)}/content" target="_blank" rel="noopener noreferrer">登録したPDFを開く ↗</a>` : "";
    const paperDetails = item.itemType === "paper" ? `<dl><div><dt>キーワード</dt><dd>${esc(item.keywords.join("、") || "なし")}</dd></div></dl>${item.bibtexCode?`<section class="bibtex-view"><h3>BibTeXコード</h3><pre>${esc(item.bibtexCode)}</pre><button type="button" class="secondary" data-copy-bibtex>コードをコピー</button></section>`:'<p class="muted">BibTeXコードは未登録です。</p>'}${sourceFile}${item.doi ? `<a class="external-link" href="${esc(`https://doi.org/${item.doi}`)}" target="_blank" rel="noopener noreferrer">DOIを開く：${esc(item.doi)} ↗</a>` : ""}` : sourceFile;
    return `<div class="overlay" data-close><article class="drawer" data-drawer><button class="close" data-close>×</button><p class="eyebrow">${esc(type.title)}</p><h2>${item.favorite ? '<span class="favorite-star">★</span> ' : ""}${esc(item.title)}</h2><div class="drawer-mode-toggle"><button data-edit-library="${esc(item.id)}">編集：OFF</button></div><p class="authors">${esc(item.authors.join(", "))} · ${esc(item.year || "出版年不明")} · ${esc(item.publication)}</p><div class="library-tags">${item.tagIds.map((id) => `<i>${esc(tags.get(id)?.name || id)}</i>`).join("")}</div><dl><div><dt>状態</dt><dd>${esc(readingStatuses.find((status) => status.id === item.status)?.label || item.status)}</dd></div><div><dt>お気に入り</dt><dd>${item.favorite ? "★ 登録済み" : "未登録"}</dd></div></dl>${paperDetails}<section><h3>メモ（LaTeX対応）</h3><div class="rich-text">${renderMarkup(item.takeawayMarkdown)}</div></section>${related.length ? `<section><h3>関連する日記</h3>${related.map((journal) => `<button class="linked-item" data-journal="${esc(journal.id)}">${esc(journal.title)}<small>${esc(journal.entryDate)}</small></button>`).join("")}</section>` : ""}${item.url ? `<a class="external-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">資料ページを開く ↗</a>` : ""}</article></div>`;
  }
  const item = state.selected;
  if (!item) return "";
  return `<div class="overlay" data-close><article class="drawer" data-drawer><button class="close" data-close>×</button><p class="eyebrow">JOURNAL · ${esc(item.entryDate)}</p><h2>${esc(item.title)}</h2><div class="drawer-mode-toggle"><button data-edit-journal="${esc(item.id)}">編集：OFF</button></div><section><h3>記録</h3><div class="rich-text">${renderMarkup(item.bodyMarkdown)}</div></section>${item.files.length ? `<section><h3>関連ファイル</h3>${item.files.map((file) => `<button class="drawer-file" data-open-root="${esc(file.rootId)}" data-open-path="${esc(file.relativePath)}"><span><strong>${esc(file.displayName || file.relativePath.split("/").at(-1))}</strong><small>${esc(file.relativePath)}</small></span><i>開く →</i></button>`).join("")}</section>` : ""}</article></div>`;
}

const navSymbols = {
  books: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Z"/><path d="M7 17h12M8 7h7M8 10h7"/></svg>',
  papers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Z"/><path d="M15 3v5h4M9 12h7M9 15h7M9 18h5"/></svg>',
};
const navigationItems = [
  // [ページID, 記号, 日本語の表記, ショートカット番号, 英語の表記]
  ["dashboard","⌂","ホーム","1","Home"],["todo","✓","やること","2","Todo"],["goals","◎","時間割","3","Schedule"],["calendar","▦","カレンダー","4","Calendar"],
  ["analysis","≋","活動分析","5","Insights"],["worktree","⑂","作業ツリー","6","Work Tree"],["files","▱","ファイル","7","Files"],["books",navSymbols.books,"書籍","8","Books"],["papers",navSymbols.papers,"文書","9","Documents"],["settings","⚙","設定","0","Settings"],["help","?","使い方","","Help"]
];
// ナビゲーションの表示言語。右上の切替ボタンで、このPCの設定として保存する。
const navigationLanguage = () => state.bootstrap?.language === "en" ? "en" : "ja";
const languageToggle = () => `<div class="language-toggle" role="group" aria-label="表示言語 / Language">${[["ja", "日本語"], ["en", "English"]].map(([code, label]) => `<button type="button" data-language="${code}" class="${navigationLanguage() === code ? "active" : ""}" aria-pressed="${navigationLanguage() === code}">${label}</button>`).join("")}</div>`;
const shortcutModifier = () => state.bootstrap?.platform === "darwin" ? "⌘" : "Ctrl+";

function shell() {
  const views = { dashboard: dashboardView, goals: goalsView, analysis: analysisView, calendar: calendarView, worktree: workTreeView, search: searchView, files: filesView, books: () => libraryView("book"), papers: () => libraryView("paper"), settings: settingsViewV2, help: helpView, todo: () => window.TickTockTomeTodo.view() };
  return `<main><aside class="sidebar"><div class="brand"><img class="brand-mark" src="/favicon.svg?v=4" alt=""><strong>Tomelet</strong></div><nav>${navigationItems.map(([id, icon, japanese, shortcut, english]) => `<button data-view="${id}" title="${navigationLanguage() === "en" ? japanese : english}" class="${state.view === id ? "active" : ""}"><span>${icon}</span><span class="nav-copy"><b>${navigationLanguage() === "en" ? english : japanese}</b><small>${shortcut}</small></span></button>`).join("")}</nav><p class="nav-shortcut-help"><span><kbd>${shortcutModifier()}</kbd>${navigationLanguage() === "en" ? " + number to switch pages" : "＋番号でページ切替"}</span><small>${navigationLanguage() === "en" ? "Home–Settings: 1–9, 0" : "ホーム〜設定：1〜9・0"}</small></p><div id="sidebarTimer" class="sidebar-timer"><span>LOCAL TIME</span><strong>--:--:--</strong></div></aside><section class="workspace"><header class="topbar"><label class="search-wrap"><span>⌕</span><input id="globalSearch" type="search" value="${esc(state.query)}" placeholder="日記・作業履歴・ファイル・資料を検索"><kbd>${shortcutModifier()}K</kbd></label>${state.bootstrap?.memoApp?.installed ? '<button class="visibility-button memo-launch-button" data-open-memo="" aria-label="新しいメモ" title="PopNote!で新しいメモを開く">✎</button>' : ""}${languageToggle()}<button class="visibility-button ${state.tagPanelOpen ? "active" : ""}" data-tag-panel aria-label="タグ表示設定" title="タグ表示設定">◉</button>${tagVisibilityPanel()}${state.bootstrap?.dataset ? window.TickTockTomeDataset.switcher(state.bootstrap) : ""}</header><div class="content">${(views[state.view] || dashboardView)()}</div></section></main>${drawer()}${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}`;
}

// HOMEの指標を0から目標値まで数え上げる。
function countUpHomeMetrics() {
  const targets = [...app.querySelectorAll(".home-intro [data-count]")];
  const started = performance.now(), duration = 900;
  const step = (now) => {
    const progress = Math.min(1, (now - started) / duration), eased = 1 - (1 - progress) ** 3;
    targets.forEach((node) => { node.textContent = Math.round(Number(node.dataset.count) * eased); });
    if (progress < 1) requestAnimationFrame(step);
  };
  if (targets.length) requestAnimationFrame(step);
}

function render() {
  state.viewEntered = state.lastRenderedView !== state.view;
  state.lastRenderedView = state.view;
  app.innerHTML = shell();
  if (state.view === "dashboard" && state.viewEntered) countUpHomeMetrics();
  const form = app.querySelector("[data-action-form]");
  decorateActionForm(form); decorateLibraryView();
  if (form && !form.elements.actionDate) form.insertAdjacentHTML("afterbegin", `<label class="goal-field action-date-field"><span>日付</span><input type="date" name="actionDate" required value="${esc(form.dataset.actionDate || state.goalDate)}"></label>`);
  if(state.view==='goals'){const switcher=app.querySelector('.goal-date-switch');if(switcher&&!switcher.querySelector('[data-goal-today]'))switcher.insertAdjacentHTML('beforeend','<button type="button" data-goal-today>本日</button>');}
  const searchKey=app.querySelector('.search-wrap kbd');if(searchKey)searchKey.textContent=`${shortcutModifier()}F`;
  app.querySelectorAll('.sidebar nav .nav-copy small').forEach(node=>{if(!node.textContent.trim())node.remove();});
  
  if(state.view==='settings'){
    const tagManagement=app.querySelector('.tag-management');
    const copy=tagManagement?.querySelector('p');if(copy)copy.textContent='分類は「関係・分野・テーマ・プロジェクト・活動・文脈・媒体・その他」の8種類で固定されています。';
    app.querySelectorAll('.tag-category-table').forEach((section,index)=>{const category=state.bootstrap.tagCategories[index];const title=section.querySelector('h3');if(category&&title)title.insertAdjacentHTML('afterend',`<p class="tag-category-description">${esc(category.description||'この分類に合うタグを追加します。')}</p>`);});
    if(tagManagement){const rows=(state.bootstrap.archivedTags||[]).map(tag=>`<div class="simple-row"><span><strong>${esc(tag.name)}</strong><small>${esc(tag.categoryName)} · ${esc(tag.description||'説明なし')}</small></span><button data-tag-restore="${esc(tag.id)}" data-revision="${tag.revision}">復元</button></div>`).join('')||'<p class="muted">アーカイブ済みのタグはありません。</p>';tagManagement.insertAdjacentHTML('beforeend',`<section class="archived-tags"><h3>アーカイブ済み</h3>${rows}</section>`);}
  }
  if(state.view==='calendar'){
    const legend=app.querySelector('.legend');if(legend)legend.innerHTML='<span><i class="kind-dot" style="--activity-color:#3f8d63"></i>アクション</span><span><i class="kind-dot" style="--activity-color:#d85858"></i>未完了Todo</span><span><i class="kind-dot" style="--activity-color:#9b7432"></i>メモ</span><span>日記・作業履歴</span>';
  }
  if(state.view==='help'){
    const intro=app.querySelector('.help-intro span');if(intro)intro.innerHTML='Todoに集める → 時間割へ取り込む → タイマーを見ながら実行 → 活動分析で気づきを得る<br>HOME〜文書は⌘/Ctrl＋1〜9、設定は⌘/Ctrl＋0で切り替えられます。検索は⌘/Ctrl＋Fです。';
    const list=app.querySelector('.help-list');if(list)list.insertAdjacentHTML('beforeend','<article class="help-card"><div class="help-placeholder">✓</div><div><span class="help-step">STEP 11</span><h2>終了時に実績を振り返る</h2><p>完了ボタンで達成度とメモを記録します。</p><ul><li>100%未満なら、Todoに残すかをその場で選べます。</li><li>Todoへ残す場合の期限日は初期状態で今日です。</li><li>終了時間を過ぎた未処理の予定は、次回起動時に1件ずつ確認します。</li></ul></div></article><article class="help-card"><div class="help-placeholder">⌁</div><div><span class="help-step">STEP 12</span><h2>使い終えたタグをアーカイブする</h2><p>設定のタグ管理から、一時的に選択肢から外せます。</p><ul><li>過去の記録との関係は削除されません。</li><li>右上の一時非表示には、使用中のタグだけが並びます。</li><li>必要になったら設定画面から復元できます。</li></ul></div></article>');
  }
  document.dispatchEvent(new CustomEvent("ticktocktome:navigation-rendered", { detail: { view: state.view } }));
}
document.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-open-folder]");
  const addButton = event.target.closest("[data-action-add-folder]");
  const removeButton = event.target.closest("[data-action-remove-folder]");
  if (!openButton && !addButton && !removeButton) return;
  event.preventDefault();
  try {
    if (openButton) { await api.openPath("base", openButton.dataset.openFolder); return; }
    const form = event.target.closest("[data-action-form]");
    if (!form) return;
    const input = actionInput(form);
    if (addButton) {
      const picked = await api.pickPath("base", "folder");
      state.selectedAction = { ...state.selectedAction, ...input, folderPaths: [...new Set([...input.folderPaths, picked.relativePath])] };
    } else state.selectedAction = { ...state.selectedAction, ...input, folderPaths: input.folderPaths.filter((folder) => folder !== removeButton.dataset.actionRemoveFolder) };
    render();
  } catch (error) { notice(error.message); }
});

function notice(message) { state.notice = message; render(); clearTimeout(notice.timer); notice.timer = setTimeout(() => { state.notice = ""; render(); }, 3800); }

async function loadView(view) {
  state.view = view;
  if (view === "dashboard") await loadHomeSummary();
  if (view === 'todo') await window.TickTockTomeTodo.load();
  if (view === "journal") state.journals = (await api.journals()).items;
  if (view === "goals") { const [actions, files, books, papers] = await Promise.all([api.dailyActions({ date: state.goalDate }), api.files(), api.library("book"), api.library("paper")]); state.dailyActions = actions.items; state.goalFiles = files.items; state.goalLibraryItems = [...books.items, ...papers.items]; state.actionDrafts = []; }
  if (view === "analysis") { state.recordActions = (await api.dailyActions({ limit: 2000 })).items; state.analysis = (await api.dailyAnalysis(state.analysisDate)).item; }
  if (view === "calendar") { const [events, actions] = await Promise.all([api.calendar(monthKey(state.month)), api.dailyActions({ limit: 1000 })]); state.calendar = events.items; state.calendarActions = actions.items; await window.TickTockTomeTodo.load(); state.calendarTodos=window.TickTockTomeTodo.items(); }
  if (view === "worktree") state.workTree = (await api.dailyActions({ limit: 1000 })).items;
  if (view === "files") { const result = await api.files(); state.files = result.items; state.fileTotal = result.total; }
  if (["books", "papers"].includes(view)) state.libraryItems = (await api.library({ books: "book", papers: "paper" }[view])).items;
  if (view === "settings") state.trash = (await api.trash()).items;
  render();
}

async function loadActionReferences() {
  const [files, books, papers] = await Promise.all([api.files(), api.library("book"), api.library("paper")]);
  state.goalFiles = files.items;
  state.goalLibraryItems = [...books.items, ...papers.items];
}

async function loadHomeSummary() {
  const [files, books, papers] = await Promise.all([api.files(), api.library("book"), api.library("paper")]);
  state.fileTotal = files.total;
  state.homeLibrary = [...books.items, ...papers.items];
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-view],[data-journal],[data-file],[data-library],[data-close],[data-new-journal],[data-record-add],[data-new-tag],[data-new-library],[data-new-root],[data-edit-root],[data-edit-journal],[data-edit-library],[data-save-file-tags],[data-open-root],[data-restore],[data-purge],[data-dismiss-root-check],[data-open-root-setup],[data-month],[data-calendar-mode],[data-calendar-shift],[data-calendar-day],[data-calendar-open-day],[data-analysis-day],[data-run-analysis],[data-analysis-suggestion],[data-graph-category],[data-graph-all],[data-library-mode],[data-action-add],[data-action-choice],[data-action-edit],[data-action-delete],[data-draft-delete],[data-goal-day],[data-theme-reset],[data-battery-reset],[data-theme-preset],[data-tag-panel],[data-choose-content],[data-copy-bibtex],[data-action-add-file],[data-action-add-library],[data-open-memo]");
  if (!target) return;
  if (target.hasAttribute("data-close") && event.target.closest("[data-drawer]") && !event.target.closest("button[data-close]")) return;
  try {
    if (target.hasAttribute("data-open-memo")) await openMemoWindow(target.dataset.openMemo);
    else if (target.dataset.view) await loadView(target.dataset.view);
    else if (target.dataset.journal) { state.selectedFile = null; state.selectedLibrary = null; state.selected = (await api.journal(target.dataset.journal)).item; render(); }
    else if (target.dataset.file) { state.selected = null; state.selectedLibrary = null; state.selectedFile = (await api.file(target.dataset.file)).item; render(); }
    else if (target.dataset.library) { state.selected = null; state.selectedFile = null; state.selectedLibrary = (await api.libraryItem(target.dataset.library)).item; render(); }
    else if (target.hasAttribute("data-close")) { state.selected = null; state.selectedFile = null; state.selectedLibrary = null; state.selectedAction = null; state.actionChooser=false; render(); }
    else if (target.hasAttribute("data-copy-bibtex")) { await navigator.clipboard.writeText(state.selectedLibrary?.bibtexCode||""); notice("BibTeXコードをコピーしました。"); }
    else if (target.hasAttribute("data-new-journal")) window.TickTockTomeEditor.open();
    else if (target.dataset.recordAdd) window.TickTockTomeEditor.open(null, target.dataset.recordAdd);
    else if (target.hasAttribute("data-new-tag")) window.TickTockTomeEditor.openTag();
    else if (target.dataset.newLibrary) window.TickTockTomeEditor.openLibrary(target.dataset.newLibrary);
    else if (target.dataset.month) { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + Number(target.dataset.month), 1); state.calendar = (await api.calendar(monthKey(state.month))).items; render(); }
    else if (target.dataset.calendarMode) { state.calendarMode = target.dataset.calendarMode; render(); }
    else if (target.dataset.calendarShift) { state.weekDate = new Date(state.weekDate.getFullYear(), state.weekDate.getMonth(), state.weekDate.getDate() + Number(target.dataset.calendarShift)); render(); }
    else if (target.dataset.calendarOpenDay) { state.calendarDay=target.dataset.calendarOpenDay;state.calendarMode='day';const date=new Date(`${state.calendarDay}T12:00:00`);state.month=new Date(date.getFullYear(),date.getMonth(),1);state.calendar=(await api.calendar(monthKey(state.month))).items;render(); }
    else if (target.dataset.calendarDay) { state.calendarDay=target.dataset.calendarDay==='today'?localDate():shiftDate(state.calendarDay,Number(target.dataset.calendarDay));const date=new Date(`${state.calendarDay}T12:00:00`);state.month=new Date(date.getFullYear(),date.getMonth(),1);state.calendar=(await api.calendar(monthKey(state.month))).items;render(); }
    else if (target.dataset.analysisDay) { state.analysisDate=shiftDate(state.analysisDate,Number(target.dataset.analysisDay));state.analysis=(await api.dailyAnalysis(state.analysisDate)).item;render(); }
    else if (target.hasAttribute('data-run-analysis')) { target.disabled=true;state.analysis=(await api.runDailyAnalysis(state.analysisDate)).item;render();notice('ローカルLLMによる分析が完了しました。'); }
    else if (target.dataset.analysisSuggestion) { const due=shiftDate(state.analysisDate,1)<localDate()?localDate():shiftDate(state.analysisDate,1);await api.createTodo({title:target.dataset.analysisSuggestion,dueDate:due,progress:0,tagIds:[],managedFileIds:[],libraryIds:[]});await window.TickTockTomeTodo.load();notice('アクション候補をTodoへ追加しました。'); }
    else if (target.dataset.graphCategory) { const ids = state.bootstrap.tags.filter((tag) => tag.categoryId === target.dataset.graphCategory).map((tag) => tag.id); const all = ids.every((id) => state.graphTags.has(id)); ids.forEach((id) => all ? state.graphTags.delete(id) : state.graphTags.add(id)); render(); }
    else if (target.hasAttribute("data-graph-all")) { const all = state.graphTags.size === state.bootstrap.tags.length; state.graphTags = new Set(all ? [] : state.bootstrap.tags.map((tag) => tag.id)); render(); }
    else if (target.dataset.editJournal) window.TickTockTomeEditor.open(state.selected);
    else if (target.dataset.editLibrary) window.TickTockTomeEditor.openLibrary(state.selectedLibrary.itemType, state.selectedLibrary);
    else if (target.hasAttribute("data-save-file-tags")) { const tagIds = [...document.querySelectorAll("[data-file-tag]:checked")].map((input) => input.value); state.selectedFile = (await api.updateFileTags(state.selectedFile.id, { tagIds, metadataRevision: state.selectedFile.metadataRevision })).item; const result = await api.files(); state.files = result.items; state.fileTotal = result.total; render(); notice("タグを保存しました。"); }
    else if (target.dataset.libraryMode) { state.libraryMode = target.dataset.libraryMode; render(); }
    else if (target.hasAttribute("data-action-add")) {
      await loadActionReferences();
      state.actionFileQuery = ""; state.actionFileSort = "latest";
      await window.TickTockTomeTodo.load(); state.actionChooser=true; state.selectedAction=null;
      render();
    }
    else if (target.dataset.actionChoice) {
      const times=defaultActionTimes(),todo=window.TickTockTomeTodo.items().find(item=>item.id===target.dataset.actionChoice);
      state.actionChooser=false;
      state.selectedAction={actionDate:localDate(),...times,action:todo?.title||"",location:"",progress:Number(todo?.progress||0),tagIds:todo?.tagIds||[],todoId:todo?.id||"",fileIds:[],managedFileIds:todo?.managedFileIds||[],libraryIds:todo?.libraryIds||[],folderPaths:todo?.folderPaths||[],completions:[],uploads:[]};
      render();
    }
    else if (target.dataset.actionEdit) {
      await loadActionReferences();
      let item = [...state.dailyActions, ...state.recordActions, ...state.todayActions, ...state.recentActions, ...state.calendarActions, ...state.workTree].find((entry) => entry.id === target.dataset.actionEdit);
      if (!item) item = (await api.dailyActions({ limit: 2000 })).items.find((entry) => entry.id === target.dataset.actionEdit);
      if (!item) throw new Error("アクションを読み込めませんでした。");
      state.actionFileQuery = ""; state.actionFileSort = "latest"; state.selectedAction = item; render();
    }
    else if (target.hasAttribute("data-action-add-file")) {
      const form=target.closest("[data-action-form]");
      if(form)state.selectedAction={...state.selectedAction,...actionInput(form)};
      const picked = await api.pickPath("base", "file");
      const result = await api.referenceFile({ rootId: "base", relativePath: picked.relativePath });
      state.goalFiles = (await api.files()).items;
      state.selectedAction.managedFileIds = [...new Set([...(state.selectedAction.managedFileIds || []), result.item.id])];
      render(); notice("ファイルを登録し、このアクションへ選択しました。");
    }
    else if (target.dataset.actionAddLibrary) {
      const form=target.closest("[data-action-form]");
      if(form)state.selectedAction={...state.selectedAction,...actionInput(form)};
      window.__tickTockTomeResourceReturn = { kind: "action", itemType: target.dataset.actionAddLibrary };
      window.TickTockTomeEditor.openLibrary(target.dataset.actionAddLibrary);
    }
    else if (target.dataset.draftDelete) { state.actionDrafts = state.actionDrafts.filter((item) => item._draftId !== target.dataset.draftDelete); render(); }
    else if (target.dataset.actionDelete) { await api.deleteDailyAction(target.dataset.actionDelete, Number(target.dataset.revision)); state.selectedAction = null; await refreshActions(); notice("アクションを削除しました。"); }
    else if (target.dataset.goalDay) { state.goalDate = shiftDate(state.goalDate, Number(target.dataset.goalDay)); state.dailyActions = (await api.dailyActions({ date: state.goalDate })).items; state.actionDrafts = []; render(); }
    else if (target.hasAttribute("data-battery-reset")) { if (!(await window.TickTockTomeDialog.confirm("ページごとの配色を既定の色に戻しますか？", { okLabel: "戻す" }))) return; const result = await api.updateTheme({ revision: state.bootstrap.settingsRevision, themeMode: state.bootstrap.themeMode || "auto", batteryColors: defaultBatteryColors, theme: state.bootstrap.theme }); Object.assign(state.bootstrap, result); applyBatteryColors(); applyTheme({ powered: true, view: state.view }); render(); notice("ページごとの配色を既定に戻しました。"); }
    else if (target.hasAttribute("data-theme-reset")) { const result = await api.updateTheme({ revision: state.bootstrap.settingsRevision, themeMode: "auto", batteryColors: defaultBatteryColors, theme: themePresets.light }); Object.assign(state.bootstrap, result); applyBatteryColors(); applyTheme({ powered: true, view: state.view }); render(); notice("外見を初期設定へ戻しました。"); }
    else if (target.dataset.themePreset) { const preset = themePresets[target.dataset.themePreset]; document.querySelector('[name="background"]').value = preset.background; document.querySelector('[name="surface"]').value = preset.surface; document.querySelector('[name="accent"]').value = preset.accent; document.querySelector('[name="text"]').value = preset.text; const manual = document.querySelector('[name="themeMode"][value="manual"]'); if (manual) { manual.checked = true; manual.closest("[data-theme-form]").dataset.themeMode = "manual"; } }
    else if (target.hasAttribute("data-tag-panel")) { state.tagPanelOpen = !state.tagPanelOpen; render(); }
    else if (target.dataset.openRoot) { await api.openPath(target.dataset.openRoot, target.dataset.openPath); notice("OSの標準アプリで開きました。"); }
    else if (target.dataset.restore) { const type = target.dataset.trashType, label = { library: "資料" }[type] || "日記"; await ({ library: api.restoreLibrary }[type] || api.restore)(target.dataset.restore, Number(target.dataset.revision)); await initialize("settings"); notice(`${label}を復元しました。`); }
    else if (target.dataset.purge) { if (!(await window.TickTockTomeDialog.confirm("完全削除すると元に戻せません。削除しますか？", { okLabel: "完全削除", danger: true }))) return; const type = target.dataset.trashType, label = { library: "資料" }[type] || "日記"; await ({ library: api.purgeLibrary }[type] || api.purge)(target.dataset.purge, Number(target.dataset.revision)); await initialize("settings"); notice(`${label}を完全削除しました。`); }
  } catch (error) { notice(error.message); }
});

// メモの作成・編集は連携アプリPopNote!で行う。
async function openMemoWindow(memoId = "") {
  await api.memoWindow(memoId);
}

function actionInput(form) {
  const data = new FormData(form);
  return { actionDate: data.get("actionDate") || form.dataset.actionDate || state.goalDate, startTime: data.get("startTime"), endTime: data.get("endTime"), action: data.get("action"), location: data.get("location"), progress: Number(data.get("progress")), tagIds: data.getAll("tagIds"), fileIds: state.selectedAction?.fileIds || data.getAll("fileIds"), managedFileIds: state.selectedAction?.managedFileIds || data.getAll("managedFileIds"), todoId: data.get('todoId') || state.selectedAction?.todoId || '', libraryIds: state.selectedAction?.libraryIds || data.getAll("libraryIds"), uploadIds: data.getAll("uploadIds"), folderPaths: data.getAll("folderPaths"), completions: String(data.get("completions") || "").split("\n").map((value) => value.trim()).filter(Boolean), displayOrder: Number(state.selectedAction?.displayOrder || state.dailyActions.length + 1), ...(form.dataset.actionId ? { revision: Number(form.dataset.revision) } : {}) };
}

async function refreshActions() {
  if (state.view === "goals") state.dailyActions = (await api.dailyActions({ date: state.goalDate })).items;
  if (state.view === "analysis") state.recordActions = (await api.dailyActions({ limit: 2000 })).items;
  if (state.view === "calendar") state.calendarActions = (await api.dailyActions({ limit: 1000 })).items;
  if (state.view === "worktree") state.workTree = (await api.dailyActions({ limit: 1000 })).items;
  state.todayActions = state.view === "goals" && state.goalDate === localDate() ? state.dailyActions : (await api.dailyActions({ date: localDate() })).items;
  state.recentActions = (await api.dailyActions({ from: weekStart(), to: shiftDate(weekStart(), 6), limit: 1000 })).items;
  state.actionDrafts = [];
  state.selectedAction = null;
  window.__tickTockTomeTodayActions = state.todayActions.filter(visibleByTags);
  document.dispatchEvent(new CustomEvent("ticktocktome:actions-changed"));
  render();
}

app.addEventListener("submit", async (event) => {
  try {
    if (event.target.matches("[data-action-form]")) {
      event.preventDefault();
      const input = actionInput(event.target);
      if (event.target.dataset.actionId) await api.updateDailyAction(event.target.dataset.actionId, input);
      else await api.createDailyAction(input);
      await refreshActions();
      notice("アクションを保存しました。");
    } else if (event.target.matches("[data-theme-form]")) {
      event.preventDefault();
      const data = new FormData(event.target);
      const batteryColors = Object.fromEntries(Object.keys(batteryPageLabels).map((view) => [view, data.get(`battery-${view}`)]));
      const result = await api.updateTheme({ revision: state.bootstrap.settingsRevision, themeMode: data.get("themeMode"), batteryColors, theme: { background: data.get("background"), surface: data.get("surface"), accent: data.get("accent"), text: data.get("text") } });
      Object.assign(state.bootstrap, result);
      state.bootstrap.settingsRevision = result.revision;
      applyBatteryColors();
      applyTheme({ powered: true, view: state.view });
      render();
      notice("外見を保存しました。");
    } else if (event.target.matches("[data-motion-form]")) {
      event.preventDefault();
      const data = new FormData(event.target);
      const result = await api.updateMotion({ revision: state.bootstrap.settingsRevision, illumination: data.has("illumination"), characterSpeed: Number(data.get("characterSpeed")) });
      Object.assign(state.bootstrap, result);
      state.bootstrap.settingsRevision = result.revision;
      applyTheme({ powered: true, view: state.view });
      render();
      notice("アニメーションを保存しました。");
    } else if (event.target.matches("[data-font-form]")) {
      event.preventDefault();
      const data = new FormData(event.target);
      const result = await api.updateFont({ revision: state.bootstrap.settingsRevision, fontPreset: data.get("fontPreset") });
      state.bootstrap.fontPreset = result.fontPreset;
      state.bootstrap.settingsRevision = result.revision;
      applyFont();
      render();
      notice("フォントを保存しました。");
    } else if (event.target.matches("[data-local-llm-form]")) {
      event.preventDefault();
      const data=new FormData(event.target),result=await api.updateLocalLlm({revision:state.bootstrap.settingsRevision,enabled:data.has("enabled"),analysisMode:data.get("analysisMode"),executablePath:data.get("executablePath"),modelPath:data.get("modelPath"),pdfTextPath:data.get("pdfTextPath")});
      state.bootstrap.localLlm=result.localLlm;state.bootstrap.settingsRevision=result.revision;render();notice(result.localLlm.enabled?"ローカルLLMを有効にしました。":"ローカルLLMを無効にしました。");
    } else if (event.target.matches("[data-tag-form]")) {
      event.preventDefault(); const data = new FormData(event.target);
      await api.updateTag(event.target.dataset.tagId, { revision: Number(event.target.dataset.revision), displayOrder: Number(data.get("displayOrder")), name: data.get("name"), categoryId: data.get("categoryId"), description: data.get("description") });
      await initialize("settings"); notice("タグを更新しました。");
    } else if (event.target.matches("[data-category-form]")) {
      event.preventDefault(); const data = new FormData(event.target);
      await api.updateTagCategory(event.target.dataset.categoryId, { revision: Number(event.target.dataset.revision), displayOrder: Number(data.get("displayOrder")), name: data.get("name"), description: data.get("description") });
      await initialize("settings"); notice("タグ分類を更新しました。");
    }
  } catch (error) { notice(error.message); }
});

function refreshGoalClockFromForms() {
  const host = document.querySelector("#goalClockTracks");
  if (!host) return;
  host.innerHTML = clockTracks([...document.querySelectorAll("[data-action-form]")].map((form) => actionInput(form)));
}

let searchTimer;
app.addEventListener("input", (event) => {
  if (event.target.matches("[data-action-file-search]")) {
    state.actionFileQuery = event.target.value;
    const host = event.target.closest("[data-action-form]").querySelector(".action-file-browser-host");
    host.innerHTML = actionFileBrowserContent(state.selectedAction?.managedFileIds || []);
    return;
  }
  if (event.target.closest("[data-action-form]")) { refreshGoalClockFromForms(); return; }
  if (event.target.id !== "globalSearch") return;
  state.query = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => { try { if (!state.query.trim()) { await loadView("analysis"); return; } state.search = await api.search(state.query); state.view = "search"; render(); document.querySelector("#globalSearch")?.focus(); } catch (error) { notice(error.message); } }, 180);
});
async function addPdfToShelf(itemType, file) {
  const rootId="base";
  if (file) notice('ブラウザはドロップしたファイルの絶対パスを取得できません。同じPDFを基準パスの選択画面から選んでください。');
  try {
    const picked=await api.pickPath(rootId,'file');
    const created=await api.referencePdf({itemType,rootId,relativePath:picked.relativePath});
    let item=created.item;
    if(state.bootstrap.localLlm?.enabled){
      try{const extracted=await api.extractLibraryMetadata({itemType,rootId,relativePath:picked.relativePath}),meta=extracted.metadata||{};item={...item,...meta,authors:meta.authors?.length?meta.authors:item.authors,keywords:meta.keywords?.length?meta.keywords:item.keywords};}
      catch(error){notice(`PDFは登録しましたが、自動抽出に失敗しました：${error.message}`);}
    }
    await loadView(libraryTypes[itemType].view);
    window.TickTockTomeEditor.openLibrary(itemType,item);
  }
  catch (error) { notice(error.message); }
}

app.addEventListener("change", async (event) => { if (!event.target.matches("[data-visible-tag]")) return; event.target.checked ? state.hiddenTagIds.delete(event.target.dataset.visibleTag) : state.hiddenTagIds.add(event.target.dataset.visibleTag); try { const result = await api.updateTagVisibility({ revision: state.bootstrap.settingsRevision, hiddenTagIds: [...state.hiddenTagIds] }); state.bootstrap.settingsRevision = result.revision; window.__tickTockTomeTodayActions = state.todayActions.filter(visibleByTags); document.dispatchEvent(new CustomEvent("ticktocktome:actions-changed")); if (["books", "papers"].includes(state.view)) await loadView(state.view); else render(); } catch (error) { notice(error.message); } });
app.addEventListener("change", (event) => { if (event.target.matches("[data-graph-tag]")) { event.target.checked ? state.graphTags.add(event.target.dataset.graphTag) : state.graphTags.delete(event.target.dataset.graphTag); render(); } else if (event.target.matches("[data-action-file-sort]")) { state.actionFileSort = event.target.value; event.target.closest("[data-action-form]").querySelector(".action-file-browser-host").innerHTML = actionFileBrowserContent(state.selectedAction?.managedFileIds || []); } else if (event.target.matches('[name="managedFileIds"]') && state.selectedAction) { const ids = new Set(state.selectedAction.managedFileIds || []); event.target.checked ? ids.add(event.target.value) : ids.delete(event.target.value); state.selectedAction.managedFileIds = [...ids]; } else if (event.target.matches("[data-pdf-input]")) addPdfToShelf(event.target.dataset.pdfInput, event.target.files?.[0]); else if (event.target.closest("[data-action-form]")) refreshGoalClockFromForms(); });
app.addEventListener("input", (event) => { const input = event.target.closest("[data-library-query]"); if (!input) return; const type = input.dataset.libraryQuery, caret = input.selectionStart, composing = event.isComposing; state.libraryQuery[type] = input.value; if (composing) return; render(); const next = document.querySelector(`[data-library-query="${type}"]`); if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch {} } });
app.addEventListener("compositionend", (event) => { const input = event.target.closest?.("[data-library-query]"); if (!input) return; const type = input.dataset.libraryQuery, caret = input.selectionStart; state.libraryQuery[type] = input.value; render(); const next = document.querySelector(`[data-library-query="${type}"]`); if (next) { next.focus(); try { next.setSelectionRange(caret, caret); } catch {} } });
app.addEventListener("change", (event) => { const target = event.target; if (target.matches("[data-library-sort]")) { state.librarySort[target.dataset.librarySort] = target.value; render(); } else if (target.matches("[data-library-status]")) { state.libraryStatusFilter[target.dataset.libraryStatus] = target.value; render(); } else if (target.matches("[data-library-filter-tag]")) { const ids = state.libraryTagIds[target.dataset.libraryType]; target.checked ? ids.add(target.dataset.libraryFilterTag) : ids.delete(target.dataset.libraryFilterTag); render(); } });
app.addEventListener("click", (event) => { const reset = event.target.closest("[data-library-reset]"); if (!reset) return; const type = reset.dataset.libraryReset; state.libraryQuery[type] = ""; state.librarySort[type] = "recommended"; state.libraryStatusFilter[type] = ""; state.libraryTagIds[type].clear(); render(); });
app.addEventListener("input", (event) => { if (event.target.matches("[data-file-query]")) { state.fileQuery = event.target.value; render(); document.querySelector("[data-file-query]")?.focus(); } });
app.addEventListener("change", (event) => { if (event.target.matches("[data-file-sort]")) { state.fileSort = event.target.value; render(); } else if (event.target.matches("[data-file-filter-tag]")) { event.target.checked?state.fileTagIds.add(event.target.dataset.fileFilterTag):state.fileTagIds.delete(event.target.dataset.fileFilterTag); render(); } });
app.addEventListener("change", async (event) => { if(event.target.matches("[data-analysis-date]")){state.analysisDate=event.target.value;state.analysis=(await api.dailyAnalysis(state.analysisDate)).item;render();} });
app.addEventListener("dragstart", (event) => { const action = event.target.closest("[data-calendar-action]"); if (action) event.dataTransfer.setData("text/x-ticktocktome-action", action.dataset.calendarAction); });
app.addEventListener("dragover", (event) => { const day = event.target.closest("[data-calendar-date]"); if (day) { event.preventDefault(); day.classList.add("drag-target"); } });
app.addEventListener("dragleave", (event) => event.target.closest("[data-calendar-date]")?.classList.remove("drag-target"));
app.addEventListener("drop", async (event) => { const day = event.target.closest("[data-calendar-date]"); if (!day) return; const id = event.dataTransfer.getData("text/x-ticktocktome-action"); if (!id) return; event.preventDefault(); day.classList.remove("drag-target"); const item = state.calendarActions.find((entry) => entry.id === id); if (!item || item.actionDate === day.dataset.calendarDate) return; try { await api.updateDailyAction(id, { ...item, actionDate: day.dataset.calendarDate, revision: item.revision, uploadIds: (item.uploads || []).map((upload) => upload.id) }); await loadView("calendar"); notice(`${day.dataset.calendarDate}へ移動しました。`); } catch (error) { notice(error.message); } });
app.addEventListener("dragover", (event) => { if (event.target.closest("[data-pdf-drop]")) { event.preventDefault(); event.target.closest("[data-pdf-drop]").classList.add("is-dragging"); } });
app.addEventListener("dragleave", (event) => event.target.closest("[data-pdf-drop]")?.classList.remove("is-dragging"));
app.addEventListener("drop", (event) => { const zone = event.target.closest("[data-pdf-drop]"); if (!zone) return; event.preventDefault(); zone.classList.remove("is-dragging"); addPdfToShelf(zone.dataset.pdfDrop, event.dataTransfer.files?.[0]); });
document.addEventListener("keydown", async (event) => {
  const shortcutHeld=shortcutModifier()==="⌘"?event.metaKey:event.ctrlKey;
  if(shortcutHeld&&event.key.toLowerCase()==="f"){event.preventDefault();document.querySelector("#globalSearch")?.focus();return;}
  if(shortcutHeld&&!event.altKey){
    const number=event.code.match(/^Digit([0-9])$/)?.[1];
    const shortcuts={"1":"dashboard","2":"todo","3":"goals","4":"calendar","5":"analysis","6":"worktree","7":"files","8":"books","9":"papers","0":"settings"};
    if(number&&shortcuts[number]){event.preventDefault();document.querySelector(`.sidebar nav button[data-view="${shortcuts[number]}"]`)?.click();return;}
  }
  if(event.key==="Escape"&&(state.selected||state.selectedFile||state.selectedLibrary||state.selectedAction||state.actionChooser)){state.selected=null;state.selectedFile=null;state.selectedLibrary=null;state.selectedAction=null;state.actionChooser=false;render();}
});

function blendHex(color, background, colorRatio) {
  const channels = (value) => [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
  const foreground = channels(color), base = channels(background);
  return `#${foreground.map((value, index) => Math.round(value * colorRatio + base[index] * (1 - colorRatio)).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(color) {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * r + .7152 * g + .0722 * b;
}

// ページの色から強調色を作る。白など明るい色でも背景に対して読める濃さ（コントラスト比4.5以上）まで暗くする。
function readableAccent(color, background) {
  const contrast = (a, b) => { const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (light + .05) / (dark + .05); };
  for (let ratio = .82; ratio > 0; ratio -= .06) {
    const accent = blendHex(color, "#22282d", ratio);
    if (contrast(accent, background) >= 4.5) return accent;
  }
  return "#22282d";
}

function automaticTheme(view) {
  const color = state.bootstrap?.batteryColors?.[view] || defaultBatteryColors[view] || "#96968f";
  const background = blendHex(color, "#ffffff", .13);
  return { background, surface: blendHex(color, "#ffffff", .23), accent: readableAccent(color, background), text: "#22282d" };
}

const unlitTheme = { background: "#d7d9d6", surface: "#e0e2df", accent: "#7f8581", text: "#333835" };

function setThemeVariables(theme) {
  if (!theme) return;
  document.documentElement.style.setProperty("--paper", theme.background);
  document.documentElement.style.setProperty("--theme-surface", theme.surface);
  document.documentElement.style.setProperty("--coral", theme.accent);
  document.documentElement.style.setProperty("--ink", theme.text || "#22282d");
  document.documentElement.style.setProperty("--muted", `color-mix(in srgb, ${theme.text || "#22282d"} 62%, ${theme.background})`);
  document.documentElement.style.setProperty("--line", `color-mix(in srgb, ${theme.text || "#22282d"} 18%, ${theme.background})`);
}

function applyTheme({ powered = false, view = state.view, animate = false, origin = null } = {}) {
  if (!state.bootstrap) return;
  const automatic = state.bootstrap.themeMode !== "manual";
  // 照明演出がオフなら、消灯を挟まずに切り替えと同時にページの色へ変える。
  const synchronized = state.bootstrap.illumination !== false;
  if (!synchronized) { powered = true; animate = false; }
  const theme = automatic ? (powered ? automaticTheme(view) : unlitTheme) : state.bootstrap.theme;
  // ボタンはページの配色に左右されない固定色。手動モードでは利用者が選んだ強調色を使う。
  document.documentElement.style.setProperty("--button-accent", automatic ? "#e3654f" : state.bootstrap.theme.accent);
  if (!automatic) { document.documentElement.classList.remove("theme-unlit"); setThemeVariables(theme); return; }
  if (!powered) { document.documentElement.classList.add("theme-unlit"); setThemeVariables(theme); return; }
  // 色が円形に広がるだけの穏やかな演出なので、「視差効果を減らす」設定でも再生する。
  if (!animate || typeof document.startViewTransition !== "function") { document.documentElement.classList.remove("theme-unlit"); setThemeVariables(theme); return; }
  if (origin) {
    document.documentElement.style.setProperty("--theme-origin-x", `${origin.x}px`);
    document.documentElement.style.setProperty("--theme-origin-y", `${origin.y}px`);
    const radius = Math.max(...[[0, 0], [innerWidth, 0], [0, innerHeight], [innerWidth, innerHeight]].map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)));
    document.documentElement.style.setProperty("--theme-reveal-radius", `${Math.ceil(radius) + 2}px`);
  }
  document.documentElement.style.setProperty("--theme-light-color", state.bootstrap.batteryColors?.[view] || defaultBatteryColors[view] || "#96968f");
  document.startViewTransition(() => { document.documentElement.classList.remove("theme-unlit"); setThemeVariables(theme); });
}

function applyBatteryColors() {
  const colors = { ...defaultBatteryColors, ...(state.bootstrap?.batteryColors || {}) };
  for (const [view, color] of Object.entries(colors)) {
    document.documentElement.style.setProperty(`--power-${view}-strong`, color);
    document.documentElement.style.setProperty(`--power-${view}-soft`, blendHex(color, "#ffffff", .28));
  }
}

document.addEventListener("ticktocktome:navigation-rendered", (event) => {
  if (state.bootstrap && state.bootstrap.illumination === false) applyTheme({ powered: true, view: event.detail?.view || state.view });
});

document.addEventListener("ticktocktome:power-change", (event) => {
  if (state.bootstrap?.illumination === false) return;
  applyTheme({ powered: Boolean(event.detail?.powered), view: event.detail?.view || state.view, animate: Boolean(event.detail?.powered), origin: event.detail?.origin });
});

function applyFont() {
  document.documentElement.dataset.font = state.bootstrap?.fontPreset || "classic";
}

async function initialize(view = "dashboard") {
  state.bootstrap = await api.bootstrap();
  window.__tickTockTomeBootstrap = state.bootstrap;
  window.TickTockTomeI18n.setLanguage(state.bootstrap.language);
  if (state.bootstrap.setupRequired) { applyBatteryColors(); applyFont(); window.TickTockTomeDataset.renderSetup(app, state.bootstrap); return; }
  await window.TickTockTomeTodo.load();
  applyBatteryColors();
  applyTheme({ powered: false, view });
  applyFont();
  state.hiddenTagIds = new Set(state.bootstrap.hiddenTagIds || []);
  const validTags = new Set(state.bootstrap.tags.map((tag) => tag.id));
  state.graphTags = state.graphTags.size ? new Set([...state.graphTags].filter((id) => validTags.has(id))) : new Set(validTags);
  state.journals = (await api.journals()).items;
  window.__tickTockTomeJournals = state.journals;
  state.todayActions = (await api.dailyActions({ date: localDate() })).items;
  state.recentActions = (await api.dailyActions({ from: weekStart(), to: shiftDate(weekStart(), 6), limit: 1000 })).items;
  await loadHomeSummary();
  window.__tickTockTomeTodayActions = state.todayActions.filter(visibleByTags);
  if (view === "goals") { const [files, books, papers] = await Promise.all([api.files(), api.library("book"), api.library("paper")]); state.goalDate = localDate(); state.dailyActions = state.todayActions; state.goalFiles = files.items; state.goalLibraryItems = [...books.items, ...papers.items]; state.actionDrafts = []; }
  if (view === "analysis") { state.recordActions = (await api.dailyActions({ limit: 2000 })).items; state.analysis=(await api.dailyAnalysis(state.analysisDate)).item; }
  if (view === "calendar") { const [events, actions] = await Promise.all([api.calendar(monthKey(state.month)), api.dailyActions({ limit: 1000 })]); state.calendar = events.items; state.calendarActions = actions.items; await window.TickTockTomeTodo.load(); state.calendarTodos=window.TickTockTomeTodo.items(); }
  if (view === "worktree") state.workTree = (await api.dailyActions({ limit: 1000 })).items;
  if (view === "files") { const result = await api.files(); state.files = result.items; state.fileTotal = result.total; }
  if (view === "settings") state.trash = (await api.trash()).items;
  state.view = view;
  render();
  window.TickTockTomeDataset.askCompanionMemos(state.bootstrap);
  if(state.bootstrap.localLlm?.enabled&&state.bootstrap.localLlm.analysisMode==='auto'&&!window.__tickTockTomeAutoAnalysisStarted){window.__tickTockTomeAutoAnalysisStarted=true;setTimeout(()=>api.autoDailyAnalysis().catch(()=>{}),1200);}
}

window.onTickTockTomeChanged = async (selectedId = null) => { await initialize("calendar"); if (selectedId) state.selected = (await api.journal(selectedId)).item; render(); };
window.onLibraryChanged = async (itemType, selectedId = null) => {
  if (window.__tickTockTomeResourceReturn?.kind === "action" && selectedId) {
    await loadActionReferences();
    state.selectedAction.libraryIds = [...new Set([...(state.selectedAction.libraryIds || []), selectedId])];
    window.__tickTockTomeResourceReturn = null;
    render(); notice("資料を登録し、このアクションへ選択しました。"); return;
  }
  if (window.__tickTockTomeResourceReturn?.kind === "todo" && selectedId && window.TickTockTomeTodo?.acceptLibrary) {
    window.__tickTockTomeResourceReturn = null;
    await window.TickTockTomeTodo.acceptLibrary(selectedId);
    return;
  }
  const view = libraryTypes[itemType].view; await loadView(view); state.selectedLibrary = selectedId ? (await api.libraryItem(selectedId)).item : null; render();
};
window.onSettingsChanged = async () => { await initialize("settings"); };
app.addEventListener('input',event=>{
  if(event.target.matches('input[name="progress"]')) event.target.nextElementSibling.textContent=`${event.target.value}%`;
  if(event.target.matches('[data-action-library-search]')) {state.actionResourceQueries[event.target.dataset.actionLibrarySearch]=event.target.value;updateResourceLists(event.target.closest('[data-action-form]'));}
});
app.addEventListener('change',event=>{
  if(event.target.matches('[data-theme-form] [name="themeMode"]')){event.target.closest('[data-theme-form]').dataset.themeMode=event.target.value;return;}
  const form=event.target.closest('[data-action-form]');if(!form)return;
  if(event.target.matches('[data-action-resource-tag]')){state.actionTagId=event.target.value;updateResourceLists(form);}
  if(event.target.matches('[name="libraryIds"]')&&state.selectedAction){const ids=new Set(state.selectedAction.libraryIds||[]);event.target.checked?ids.add(event.target.value):ids.delete(event.target.value);state.selectedAction.libraryIds=[...ids];}
});
app.addEventListener('click',event=>{const button=event.target.closest('[data-reference-pdf]');if(button){event.preventDefault();addPdfToShelf(button.dataset.referencePdf,null);}});
app.addEventListener('click',async event=>{
  const languageButton=event.target.closest('[data-language]');
  if(languageButton){if(languageButton.dataset.language===navigationLanguage())return;try{await api.updateLanguage({revision:state.bootstrap.settingsRevision,language:languageButton.dataset.language});location.reload();}catch(error){notice(error.message);}return;}
  const todayButton=event.target.closest('[data-goal-today]');
  if(todayButton){state.goalDate=localDate();state.dailyActions=(await api.dailyActions({date:state.goalDate})).items;state.actionDrafts=[];render();return;}
  const archive=event.target.closest('[data-tag-archive],[data-tag-restore]');
  if(archive){try{await api.setTagArchived(archive.dataset.tagArchive||archive.dataset.tagRestore,archive.hasAttribute('data-tag-archive'),Number(archive.dataset.revision));await initialize('settings');notice(archive.hasAttribute('data-tag-archive')?'タグをアーカイブしました。':'タグを復元しました。');}catch(error){notice(error.message);}}
});
initialize().catch((error) => { app.innerHTML = `<section class="error-screen"><p class="eyebrow">LOAD ERROR</p><h1>Tomeletを読み込めませんでした。</h1><p>ランチャーから開き直してください。</p><code>${esc(error.message)}</code></section>`; });
