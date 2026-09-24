(function () {
"use strict";

const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const mathEnvironments = new Set(["equation", "equation*", "align", "align*", "aligned", "gather", "gather*", "multline", "multline*", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "cases", "array"]);

function mathHtml(source, displayMode) {
  const tex = String(source ?? "").trim();
  if (!tex) return "";
  if (!window.katex?.renderToString) return `<code class="math-source">${escapeHtml(tex)}</code>`;
  try {
    return window.katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: "warn",
      output: "htmlAndMathml",
      maxSize: 20,
      maxExpand: 1000,
    });
  } catch {
    return `<code class="math-source">${escapeHtml(tex)}</code>`;
  }
}

function inline(source) {
  const tokens = [];
  const reserve = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let text = String(source ?? "").replace(/\u0000/g, "");
  text = text.replace(/`([^`\n]+)`/g, (_, code) => reserve(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => reserve(mathHtml(tex, false)));
  text = text.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, prefix, tex) => `${prefix}${reserve(mathHtml(tex, false))}`);
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? "");
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isSpecialStart(lines, index) {
  const line = lines[index] ?? "";
  if (!line.trim()) return true;
  if (/^```/.test(line.trim()) || /^#{1,6}\s+/.test(line) || /^>\s?/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) return true;
  if (/^\s*(?:\$\$|\\\[)/.test(line)) return true;
  const environment = line.trim().match(/^\\begin\{([^}]+)\}/)?.[1];
  if (environment && mathEnvironments.has(environment)) return true;
  return line.includes("|") && isTableSeparator(lines[index + 1] ?? "");
}

function render(source) {
  const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (line.trim().startsWith("```")) {
      const language = line.trim().slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      output.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith("$$") || trimmed.startsWith("\\[")) {
      const dollar = trimmed.startsWith("$$");
      const closing = dollar ? "$$" : "\\]";
      let first = trimmed.slice(2);
      const math = [];
      if (first.endsWith(closing) && first.length > closing.length) {
        math.push(first.slice(0, -closing.length));
        index += 1;
      } else {
        if (first) math.push(first);
        index += 1;
        while (index < lines.length && !lines[index].trim().endsWith(closing)) math.push(lines[index++]);
        if (index < lines.length) { math.push(lines[index].trim().slice(0, -closing.length)); index += 1; }
      }
      output.push(`<div class="math-block">${mathHtml(math.join("\n"), true)}</div>`);
      continue;
    }

    const environment = trimmed.match(/^\\begin\{([^}]+)\}/)?.[1];
    if (environment && mathEnvironments.has(environment)) {
      const math = [line];
      index += 1;
      while (index < lines.length && !lines[index].includes(`\\end{${environment}}`)) math.push(lines[index++]);
      if (index < lines.length) math.push(lines[index++]);
      output.push(`<div class="math-block">${mathHtml(math.join("\n"), true)}</div>`);
      continue;
    }

    if (line.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      output.push(`<div class="rich-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inline(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { const level = Math.min(heading[1].length + 2, 6); output.push(`<h${level}>${inline(heading[2])}</h${level}>`); index += 1; continue; }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ""));
      output.push(`<blockquote>${quote.map((item) => inline(item)).join("<br>")}</blockquote>`);
      continue;
    }

    const unordered = /^\s*[-*+]\s+/.test(line);
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const items = [];
      const pattern = unordered ? /^\s*[-*+]\s+/ : /^\s*\d+\.\s+/;
      while (index < lines.length && pattern.test(lines[index])) items.push(lines[index++].replace(pattern, ""));
      const tag = ordered ? "ol" : "ul";
      output.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isSpecialStart(lines, index)) paragraph.push(lines[index++].trim());
    output.push(`<p>${paragraph.map((item) => inline(item)).join("<br>")}</p>`);
  }
  return output.join("");
}

function toPlainText(source) {
  return String(source ?? "")
    .replace(/```[\s\S]*?```/g, " コード ")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\$([^$\n]+?)\$/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/[|*_`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

window.ResearchMarkup = Object.freeze({ render, toPlainText });
})();
