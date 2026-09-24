"use strict";

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function validateDailyAction(input, updating = false) {
  if (!input || !validDate(input.actionDate)) throw new Error("対象日が正しくありません。");
  if (!validTime(input.startTime) || !validTime(input.endTime) || input.startTime >= input.endTime) throw new Error("開始時間と終了時間を確認してください。");
  const action = String(input.action || "").trim();
  if (!action || action.length > 300) throw new Error("アクションを1〜300文字で入力してください。");
  const location = String(input.location || "").trim();
  if (location.length > 300) throw new Error("場所は300文字以内で入力してください。");
  const progress = Number(input.progress ?? 0);
  if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("達成度は0〜100の整数にしてください。");
  const tagIds = [...new Set(Array.isArray(input.tagIds) ? input.tagIds.map(String) : [])];
  if (tagIds.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("タグの指定が正しくありません。");
  const completions = [...new Set((Array.isArray(input.completions) ? input.completions : []).map((value) => String(value).trim()).filter(Boolean))];
  if (completions.length > 100 || completions.some((value) => value.length > 500)) throw new Error("完了したことは100件以下、1件500文字以内にしてください。");
  const revision = Number(input.revision);
  if (updating && (!Number.isInteger(revision) || revision < 1)) throw new Error("更新情報が正しくありません。");
  const ids = (name) => {
    const values = [...new Set(Array.isArray(input[name]) ? input[name].map(String) : [])];
    if (values.length > 500 || values.some((id) => !/^[A-Za-z0-9_-]+$/.test(id))) throw new Error("関連項目の指定が正しくありません。");
    return values;
  };
  const todoId = String(input.todoId || "");
  if (todoId && !/^[A-Za-z0-9_-]+$/.test(todoId)) throw new Error("Todoの指定が正しくありません。");
  return { actionDate: input.actionDate, startTime: input.startTime, endTime: input.endTime, action, location, progress, tagIds, completions, todoId, fileIds: ids("fileIds"), managedFileIds: ids("managedFileIds"), libraryIds: ids("libraryIds"), uploadIds: ids("uploadIds"), displayOrder: Math.max(1, Number(input.displayOrder) || 1), ...(updating ? { revision } : {}) };
}

module.exports = { validDate, validateDailyAction };
