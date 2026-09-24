(function () {
"use strict";

async function request(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) throw new Error(result.error || `処理に失敗しました (${response.status})`);
  return result;
}

window.TickTockTomeApi = Object.freeze({
  bootstrap: () => request("/api/v1/bootstrap"),
  todos: () => request("/api/v1/todos"),
  timer: () => request('/api/v1/timer'),
  overdueActions: () => request('/api/v1/timer/overdue'),
  startTimer: (value) => request('/api/v1/timer:start',{method:'POST',body:JSON.stringify(value)}),
  completeTimer: (value) => request('/api/v1/timer:complete',{method:'POST',body:JSON.stringify(value)}),
  dailyAnalysis: (date) => request(`/api/v1/daily-analysis/${encodeURIComponent(date)}`),
  runDailyAnalysis: (date) => request(`/api/v1/daily-analysis/${encodeURIComponent(date)}:run`,{method:'POST',body:'{}'}),
  autoDailyAnalysis: () => request('/api/v1/daily-analysis:auto',{method:'POST',body:'{}'}),
  memoWindow: (memoId = "") => request('/api/v1/memo-window',{method:'POST',body:JSON.stringify({memoId})}),
  restoreMemo: (id, revision) => request(`/api/v1/memo-trash/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ revision }) }),
  purgeMemo: (id, revision) => request(`/api/v1/memo-trash/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  timerWindow: (on) => request('/api/v1/timer-window',{method:'POST',body:JSON.stringify({on})}),
  createTodo: (value) => request("/api/v1/todos", {method:"POST",body:JSON.stringify(value)}),
  updateTodo: (id,value) => request(`/api/v1/todos/${encodeURIComponent(id)}`, {method:"PUT",body:JSON.stringify(value)}),
  deleteTodo: (id,revision) => request(`/api/v1/todos/${encodeURIComponent(id)}`, {method:"DELETE",body:JSON.stringify({revision})}),
  referencePdf: (value) => request("/api/v1/library:reference-pdf", {method:"POST",body:JSON.stringify(value)}),
  journals: (query = "") => request(`/api/v1/journals${query ? `?q=${encodeURIComponent(query)}` : ""}`),
  journal: (id) => request(`/api/v1/journals/${encodeURIComponent(id)}`),
  journalByDate: (date) => request(`/api/v1/journals/by-date/${encodeURIComponent(date)}`),
  createJournal: (value) => request("/api/v1/journals", { method: "POST", body: JSON.stringify(value) }),
  createTag: (value) => request("/api/v1/tags", { method: "POST", body: JSON.stringify(value) }),
  updateTag: (id, value) => request(`/api/v1/tags/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  setTagArchived: (id, archived, revision) => request(`/api/v1/tags/${encodeURIComponent(id)}/${archived?'archive':'restore'}`, {method:'POST',body:JSON.stringify({revision})}),
  createTagCategory: (value) => request("/api/v1/tag-categories", { method: "POST", body: JSON.stringify(value) }),
  updateTagCategory: (id, value) => request(`/api/v1/tag-categories/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  upload: (value) => request("/api/v1/uploads", { method: "POST", body: JSON.stringify(value) }),
  files: () => request("/api/v1/files"),
  file: (id) => request(`/api/v1/files/${encodeURIComponent(id)}`),
  updateFileTags: (id, value) => request(`/api/v1/files/${encodeURIComponent(id)}/tags`, { method: "PUT", body: JSON.stringify(value) }),
  library: (type) => request(`/api/v1/library?type=${encodeURIComponent(type)}`),
  libraryItem: (id) => request(`/api/v1/library/${encodeURIComponent(id)}`),
  createLibraryItem: (value) => request("/api/v1/library", { method: "POST", body: JSON.stringify(value) }),
  updateLibraryItem: (id, value) => request(`/api/v1/library/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  deleteLibraryItem: (id, revision) => request(`/api/v1/library/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  updateJournal: (id, value) => request(`/api/v1/journals/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  deleteJournal: (id, revision) => request(`/api/v1/journals/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  dailyActions: ({ date = "", from = "", to = "", limit = 500 } = {}) => request(`/api/v1/daily-actions?${new URLSearchParams({ ...(date ? { date } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), limit: String(limit) })}`),
  createDailyAction: (value) => request("/api/v1/daily-actions", { method: "POST", body: JSON.stringify(value) }),
  updateDailyAction: (id, value) => request(`/api/v1/daily-actions/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(value) }),
  deleteDailyAction: (id, revision) => request(`/api/v1/daily-actions/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  timeline: () => request("/api/v1/timeline"),
  calendar: (month) => request(`/api/v1/calendar?month=${encodeURIComponent(month)}`),
  workTree: () => request("/api/v1/work-tree"),
  search: (query) => request(`/api/v1/search?q=${encodeURIComponent(query)}`),
  trash: () => request("/api/v1/trash"),
  restore: (id, revision) => request(`/api/v1/trash/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ revision }) }),
  purge: (id, revision) => request(`/api/v1/trash/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  restoreLibrary: (id, revision) => request(`/api/v1/library-trash/${encodeURIComponent(id)}/restore`, { method: "POST", body: JSON.stringify({ revision }) }),
  purgeLibrary: (id, revision) => request(`/api/v1/library-trash/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ revision }) }),
  openPath: (rootId, relativePath) => request("/api/v1/open-path", { method: "POST", body: JSON.stringify({ rootId, relativePath }) }),
  pickPath: (rootId, kind) => request("/api/v1/pick-path", { method: "POST", body: JSON.stringify({ rootId, kind }) }),
  chooseFileRoot: (value) => request("/api/v1/settings/file-roots:choose", { method: "POST", body: JSON.stringify(value) }),
  updateTheme: (value) => request("/api/v1/settings/theme", { method: "PUT", body: JSON.stringify(value) }),
  updateFont: (value) => request("/api/v1/settings/font", { method: "PUT", body: JSON.stringify(value) }),
  updateLocalLlm: (value) => request("/api/v1/settings/local-llm", { method: "PUT", body: JSON.stringify(value) }),
  referenceFile: (value) => request("/api/v1/files:reference", { method: "POST", body: JSON.stringify(value) }),
  extractLibraryMetadata: (value) => request("/api/v1/library:extract-metadata", { method: "POST", body: JSON.stringify(value) }),
  updateTagVisibility: (value) => request("/api/v1/settings/tag-visibility", { method: "PUT", body: JSON.stringify(value) }),
  chooseContentLocation: (value) => request("/api/v1/settings/content-location:choose", { method: "POST", body: JSON.stringify(value) }),
});
})();
