"use strict";

// メモ本文はcontenteditableのHTMLを保存する。装飾4種・改行・段落・箇条書きと、
// Tomeletへアップロードした画像だけを残し、属性や他のタグはすべて捨てる。
const allowedTags = new Map([
  ["b", "b"], ["strong", "b"], ["i", "i"], ["em", "i"], ["u", "u"],
  ["s", "s"], ["strike", "s"], ["del", "s"],
  ["br", "br"], ["div", "div"], ["p", "div"], ["ul", "ul"], ["ol", "ol"], ["li", "li"], ["img", "img"],
]);
const voidTags = new Set(["br", "img"]);
const uploadSource = /^\/api\/v1\/uploads\/(upload-[0-9a-f-]{36})\/content$/;
const idPattern = /^[A-Za-z0-9_-]{1,200}$/;
const maxBodyLength = 1_000_000;

function escapeText(value) {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&(?!(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#x[0-9A-Fa-f]{1,6});)/g, "&amp;");
}

function sanitizeMemoHtml(input) {
  const source = String(input || "");
  if (source.length > maxBodyLength) throw new Error("メモ本文が長すぎます。");
  const output = [], open = [], uploadIds = [];
  const pattern = /<(\/?)([A-Za-z][A-Za-z0-9]*)\b([^>]*)>|<!--[\s\S]*?-->/g;
  let last = 0, match;
  while ((match = pattern.exec(source))) {
    output.push(escapeText(source.slice(last, match.index)));
    last = pattern.lastIndex;
    if (!match[2]) continue;
    const closing = match[1] === "/", tag = allowedTags.get(match[2].toLowerCase());
    if (!tag) continue;
    if (closing) {
      const index = open.lastIndexOf(tag);
      if (index < 0) continue;
      while (open.length > index) output.push(`</${open.pop()}>`);
      continue;
    }
    if (tag === "img") {
      const src = /\bsrc\s*=\s*"([^"]*)"/i.exec(match[3])?.[1] || "";
      const upload = uploadSource.exec(src);
      if (!upload) continue;
      uploadIds.push(upload[1]);
      output.push(`<img src="${src}" alt="">`);
      continue;
    }
    if (voidTags.has(tag)) { output.push(`<${tag}>`); continue; }
    output.push(`<${tag}>`); open.push(tag);
  }
  output.push(escapeText(source.slice(last)));
  while (open.length) output.push(`</${open.pop()}>`);
  return { html: output.join(""), uploadIds: [...new Set(uploadIds)] };
}

function decodeEntities(value) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9A-Fa-f]+|#\d+|[A-Za-z]+);/g, (whole, code) => {
    if (code[0] !== "#") return named[code] ?? whole;
    const point = code[1] === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function memoPlainText(html) {
  return decodeEntities(html.replace(/<img[^>]*>/g, "［画像］").replace(/<(?:br|\/div|\/li)>/g, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\n{3,}/g, "\n\n").trim();
}

function pad(value) { return String(value).padStart(2, "0"); }

// 見出しの初期値はPCの現地時刻で「09月23日14時05分07秒のノート」とする。
function defaultMemoTitle(createdAt) {
  const date = new Date(createdAt);
  return `${pad(date.getMonth() + 1)}月${pad(date.getDate())}日${pad(date.getHours())}時${pad(date.getMinutes())}分${pad(date.getSeconds())}秒のノート`;
}

function idList(value, label) {
  const list = [...new Set(Array.isArray(value) ? value.map(String) : [])];
  if (list.length > 500 || list.some((id) => !idPattern.test(id))) throw new Error(`${label}の指定が正しくありません。`);
  return list;
}

function validateMemo(input, editing = false, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("メモの形式が正しくありません。");
  let createdAt = null;
  if (!editing) {
    createdAt = typeof input.createdAt === "string" ? input.createdAt : now.toISOString();
    const time = Date.parse(createdAt);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !Number.isFinite(time) || time > now.getTime() + 60_000) throw new Error("メモの作成日時が正しくありません。");
    createdAt = new Date(time).toISOString();
  }
  const title = String(input.title ?? "").trim().slice(0, 300) || (createdAt ? defaultMemoTitle(createdAt) : "");
  if (!title) throw new Error("見出しを入力してください。");
  const { html, uploadIds: inlineUploadIds } = sanitizeMemoHtml(input.bodyHtml);
  const result = {
    title, bodyHtml: html, bodyText: memoPlainText(html),
    tagIds: idList(input.tagIds, "タグ"),
    managedFileIds: idList(input.managedFileIds, "添付ファイル"),
    uploadIds: [...new Set([...idList(input.uploadIds, "添付画像"), ...inlineUploadIds])],
  };
  if (createdAt) result.createdAt = createdAt;
  if (editing) {
    const revision = Number(input.revision);
    if (!Number.isInteger(revision) || revision < 1) throw new Error("更新情報が正しくありません。再読み込みしてください。");
    result.revision = revision;
  }
  return result;
}

module.exports = { defaultMemoTitle, memoPlainText, sanitizeMemoHtml, validateMemo };
