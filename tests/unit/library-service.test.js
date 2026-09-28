"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateLibraryItem } = require("../../scripts/services/library-service.js");

test("書籍・論文の共通入力を検証する", () => {
  const value = validateLibraryItem({ itemType: "paper", title: "Sample Paper", authors: ["Example Author"], year: 2024, publication: "Example Journal", status: "reading", priority: 4, favorite: true, keywords: ["local-first"], doi: "10.5555/example.1", bibtexCode: "@article{Example2024, title={Sample Paper}}", takeawayMarkdown: "$E=mc^2$", url: "https://example.com/paper", tagIds: ["reading"], journalIds: [] });
  assert.match(value.bibtexCode, /^@article/);
  assert.equal(value.itemType, "paper");
  assert.deepEqual(value.authors, ["Example Author"]);
  assert.equal(value.favorite, true);
  assert.deepEqual(value.keywords, ["local-first"]);
  assert.equal(value.doi, "10.5555/example.1");
  assert.throws(() => validateLibraryItem({ itemType: "video", title: "Invalid", authors: ["A"] }), /資料種別/);
  assert.throws(() => validateLibraryItem({ itemType: "textbook", title: "Legacy", authors: ["A"] }), /資料種別/);
  assert.throws(() => validateLibraryItem({ itemType: "paper", title: "Invalid URL", authors: ["A"], url: "http://example.com" }), /HTTPS/);
  assert.throws(() => validateLibraryItem({ itemType: "paper", title: "Invalid DOI", authors: ["A"], doi: "not-a-doi" }), /DOI/);
});
