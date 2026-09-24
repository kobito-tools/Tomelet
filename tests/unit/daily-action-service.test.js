"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDailyAction } = require("../../scripts/services/daily-action-service.js");

test("今日の目標の入力を検証して整形する", () => {
  const value = validateDailyAction({ actionDate: "2026-09-14", startTime: "09:00", endTime: "10:00", action: "  読書  ", location: " 自宅 ", progress: 50, tagIds: ["reading", "reading"], completions: [" 1章 ", "1章", ""] });
  assert.equal(value.action, "読書");
  assert.deepEqual(value.tagIds, ["reading"]);
  assert.deepEqual(value.completions, ["1章"]);
});

test("終了が開始以前の目標を拒否する", () => {
  assert.throws(() => validateDailyAction({ actionDate: "2026-09-14", startTime: "10:00", endTime: "09:00", action: "不正", progress: 0 }), /開始時間/);
});
