"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { safeRelativePath } = require("../services/journal-service.js");

function resolveAllowedTarget(settings, rootId, relativePath) {
  if (!safeRelativePath(relativePath)) throw new Error("ファイルの相対パスが正しくありません。");
  const configured = settings.fileRoots.find((root) => root.id === rootId);
  if (!configured || !path.isAbsolute(configured.absolutePath)) throw new Error("基準フォルダが設定されていません。");
  const root = fs.realpathSync(configured.absolutePath);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) throw new Error("基準フォルダ外のパスは開けません。");
  const target = fs.realpathSync(candidate);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error("リンク先が基準フォルダ外を指しています。");
  fs.statSync(target);
  return target;
}

module.exports = { resolveAllowedTarget };
