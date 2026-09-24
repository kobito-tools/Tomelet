"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultMemoTitle, sanitizeMemoHtml, validateMemo } = require("../../scripts/services/memo-service.js");

test("メモ本文は装飾4種とアップロード画像だけを残す", () => {
  const upload = "upload-12345678-1234-1234-1234-123456789abc";
  const { html, uploadIds } = sanitizeMemoHtml(`<div style="color:red" onclick="x()">A<b>太字</b><strong>強</strong><u>下</u><strike>消</strike><i>斜</i></div><script>alert(1)</script><img src="/api/v1/uploads/${upload}/content" onerror="x()"><img src="https://example.invalid/a.png"><a href="javascript:x()">link</a>`);
  assert.equal(html, `<div>A<b>太字</b><b>強</b><u>下</u><s>消</s><i>斜</i></div>alert(1)<img src="/api/v1/uploads/${upload}/content" alt="">link`);
  assert.deepEqual(uploadIds, [upload]);
});

test("閉じ忘れのタグを補い、裸の山括弧を無害化する", () => {
  assert.equal(sanitizeMemoHtml("<b>a<i>b</b> 1 < 2 &amp; 3 & 4 <scr").html, "<b>a<i>b</i></b> 1 &lt; 2 &amp; 3 &amp; 4 &lt;scr");
});

test("見出しの初期値は作成時刻から作り、本文の文字列も抽出する", () => {
  const createdAt = new Date(2026, 8, 3, 4, 5, 6).toISOString();
  assert.equal(defaultMemoTitle(createdAt), "09月03日04時05分06秒のノート");
  const memo = validateMemo({ createdAt, title: " ", bodyHtml: "<div>一行目</div><div>二&amp;行目</div>", tagIds: ["tag-a", "tag-a"] });
  assert.equal(memo.title, "09月03日04時05分06秒のノート");
  assert.equal(memo.bodyText, "一行目\n二&行目");
  assert.deepEqual(memo.tagIds, ["tag-a"]);
});

test("未来の作成日時・不正なIDを拒否する", () => {
  assert.throws(() => validateMemo({ createdAt: new Date(Date.now() + 3_600_000).toISOString() }), /作成日時/);
  assert.throws(() => validateMemo({ tagIds: ["bad id"] }), /タグ/);
  assert.throws(() => validateMemo({ title: "x" }, true), /更新情報/);
});
