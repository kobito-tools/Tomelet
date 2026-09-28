"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// ブラウザ用の翻訳スクリプトを、document無しで読み込んで訳だけを確かめる。
function loadTranslator() {
  const context = { window: {}, document: { documentElement: {} }, console };
  vm.createContext(context);
  for (const file of ["js/i18n.js", "js/i18n-en.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../..", file), "utf8"), context);
  const i18n = context.window.TickTockTomeI18n;
  context.document.body = null;
  i18n.setLanguage("en");
  return i18n.translate;
}

test("Englishでは画面の日本語を英語へ置き換え、利用者の入力は変えない", () => {
  const translate = loadTranslator();
  assert.equal(translate("やること"), "Todo");
  assert.equal(translate("  外見を保存  "), "  Save appearance  ");
  assert.equal(translate("3件"), "3 items");
  assert.equal(translate("あと1日"), "1 day left");
  assert.equal(translate("「研究用」に切り替えますか？"), "Switch to “研究用”?");
  assert.equal(translate("未確認 · タグなし"), "Unverified · No tags");
  assert.equal(translate("2026年9月"), "Sep 2026");
  assert.equal(translate("学会の予稿を提出"), "学会の予稿を提出");
});
