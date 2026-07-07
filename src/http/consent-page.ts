import { TOOL_GROUPS, type ToolGroup } from "./tool-scopes.js";

/**
 * /authorize の同意ページ HTML を生成する。
 * パスフレーズ入力とツールグループ選択の両方を行う。
 */
export function renderConsentPage(opts: {
  clientName?: string;
  error?: string;
  hiddenFields: Record<string, string>;
}): string {
  const errorHtml = opts.error
    ? `<div class="error">${esc(opts.error)}</div>`
    : "";

  const hiddenInputs = Object.entries(opts.hiddenFields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("\n      ");

  const groupCheckboxes = TOOL_GROUPS.map((g) => renderGroup(g)).join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>utol-mcp — 認可リクエスト</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.3rem; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
  .error { background: #fee; border: 1px solid #c00; color: #900; padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; }
  .group { margin: 12px 0; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; }
  .group.write { border-color: #f59e0b; background: #fffbeb; }
  .group label { font-weight: 600; cursor: pointer; }
  .group .desc { font-size: 0.85rem; color: #666; margin: 2px 0 0 24px; }
  .group .tools { font-size: 0.78rem; color: #999; margin: 2px 0 0 24px; }
  .section-label { font-weight: 600; margin-top: 18px; display: block; }
  input[type="password"] { width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { margin-top: 20px; padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; width: 100%; }
  button:hover { background: #1d4ed8; }
  .info { font-size: 0.85rem; color: #666; margin-top: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>utol-mcp 認可リクエスト</h1>
  ${errorHtml}
  <p><strong>${esc(opts.clientName ?? "不明なクライアント")}</strong> が utol-mcp へのアクセスを要求しています。</p>

  <span class="section-label">許可するツール</span>
  ${groupCheckboxes}

  <form method="POST" action="/authorize" id="consent-form">
    ${hiddenInputs}
    <input type="hidden" name="granted_tools" id="granted-tools" value="">
    <label for="passphrase">パスフレーズ</label>
    <input type="password" id="passphrase" name="passphrase" autocomplete="off" required>
    <button type="submit">承認</button>
  </form>
  <p class="info">このサーバーの管理者のみが承認できます。</p>
</div>
<script>
document.getElementById('consent-form').addEventListener('submit', function() {
  var tools = [];
  document.querySelectorAll('input[data-tools]').forEach(function(cb) {
    if (cb.checked) tools.push.apply(tools, cb.getAttribute('data-tools').split(','));
  });
  document.getElementById('granted-tools').value = tools.join(',');
});
</script>
</body>
</html>`;
}

function renderGroup(g: ToolGroup): string {
  const cls = g.id === "write" ? "group write" : "group";
  const checked = g.defaultOn ? "checked" : "";
  const toolList = g.tools.join(", ");
  return `<div class="${cls}">
    <label><input type="checkbox" data-tools="${esc(g.tools.join(","))}" ${checked}> ${esc(g.label)}</label>
    <div class="desc">${esc(g.description)}</div>
    <div class="tools">${esc(toolList)}</div>
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
