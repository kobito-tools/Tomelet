(function () {
"use strict";

// 表示言語の切り替え。画面は日本語で組み立て、Englishのときだけ表示直前に英語へ置き換える。
// 利用者が入力した内容（入力欄・本文）は訳さない。辞書は i18n-en.js にある。
const JAPANESE = /[぀-ヿ㐀-鿿]/;
const ATTRIBUTES = ["placeholder", "title", "aria-label", "alt"];
const SKIP = "textarea,script,style,[contenteditable=''],[contenteditable='true'],[data-no-translate]";
let language = "ja";
let observer = null;

function dictionary() {
  return window.TickTockTomeEnglish || { exact: {}, patterns: [] };
}

// 1つの表示文字列を英語にする。辞書に無いものはそのまま返す。
function translate(text) {
  if (language !== "en" || typeof text !== "string" || !JAPANESE.test(text)) return text;
  const leading = text.match(/^\s*/)[0], trailing = text.match(/\s*$/)[0];
  const core = text.trim();
  const { exact, patterns } = dictionary();
  if (Object.hasOwn(exact, core)) return leading + exact[core] + trailing;
  for (const [pattern, replace] of patterns) {
    const match = core.match(pattern);
    if (match) return leading + replace(...match.slice(1).map((value) => value === undefined ? value : String(value))) + trailing;
  }
  return text;
}

function skipped(element) {
  return !element || Boolean(element.closest?.(SKIP)) || element.isContentEditable;
}

function translateElementAttributes(element) {
  if (skipped(element)) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute?.(name);
    if (value && JAPANESE.test(value)) { const next = translate(value); if (next !== value) element.setAttribute(name, next); }
  }
  if (element.tagName === "INPUT" && ["button", "submit", "reset"].includes(element.type) && JAPANESE.test(element.value)) element.value = translate(element.value);
  if (element.tagName === "IMG") {
    const source = element.getAttribute("src") || "";
    const english = source.replace(/^(\/assets\/help-[a-z-]+)\.svg(\?.*)?$/, "$1.en.svg$2");
    if (english !== source) element.setAttribute("src", english);
  }
}

function translateTree(root) {
  if (language !== "en" || !root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!skipped(root.parentElement) && JAPANESE.test(root.nodeValue)) { const next = translate(root.nodeValue); if (next !== root.nodeValue) root.nodeValue = next; }
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) translateElementAttributes(node);
    else if (JAPANESE.test(node.nodeValue) && !skipped(node.parentElement)) { const next = translate(node.nodeValue); if (next !== node.nodeValue) node.nodeValue = next; }
  }
}

function setLanguage(next) {
  language = next === "en" ? "en" : "ja";
  document.documentElement.lang = language;
  observer?.disconnect();
  observer = null;
  if (language !== "en" || !document.body) return;
  translateTree(document.body);
  // 描画のたびに追加・変更された部分だけを訳す（MutationObserverは描画前に実行されるため、日本語が一瞬見えることはない）。
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") record.addedNodes.forEach(translateTree);
      else if (record.type === "characterData") translateTree(record.target);
      else if (record.type === "attributes") translateElementAttributes(record.target);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES, "src"] });
}

window.TickTockTomeI18n = Object.freeze({ setLanguage, translate, language: () => language });
})();
