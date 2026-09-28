(function () {
"use strict";

// 画面内の確認・通知ダイアログ。window.confirm／alertはアプリ（WKWebView）の設定次第で
// 表示されずにキャンセル扱いになるため、アプリ内では常にこちらを使う。
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function open({ message, okLabel = "OK", cancelLabel = null, danger = false }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const host = document.createElement("div");
    host.className = "setup-overlay app-dialog";
    host.innerHTML = `<div class="setup-dialog" role="alertdialog" aria-modal="true"><p class="app-dialog-message">${esc(message)}</p><div>${cancelLabel ? `<button type="button" class="secondary" data-dialog-cancel>${esc(cancelLabel)}</button>` : ""}<button type="button" class="primary${danger ? " danger" : ""}" data-dialog-ok>${esc(okLabel)}</button></div></div>`;
    const finish = (value) => {
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      previousFocus?.focus?.();
      resolve(value);
    };
    function onKey(event) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false); }
    }
    host.addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target.closest("[data-dialog-ok]")) finish(true);
      else if (event.target.closest("[data-dialog-cancel]")) finish(false);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(host);
    host.querySelector("[data-dialog-ok]").focus();
  });
}

window.TickTockTomeDialog = Object.freeze({
  confirm: (message, options = {}) => open({ message, okLabel: options.okLabel || "OK", cancelLabel: options.cancelLabel || "キャンセル", danger: Boolean(options.danger) }),
  alert: (message) => open({ message }).then(() => undefined),
});
})();
