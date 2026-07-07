/**
 * /authorize の同意ページ HTML を生成する。
 * ユーザーがパスフレーズを入力して承認しない限り、認可コードは発行されない。
 */
export function renderConsentPage(opts: {
  clientName?: string;
  scopes: string[];
  error?: string;
  hiddenFields: Record<string, string>;
}): string {
  const scopeList = opts.scopes.length > 0
    ? opts.scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join("")
    : "<li>（デフォルトスコープ）</li>";

  const errorHtml = opts.error
    ? `<div class="error">${escapeHtml(opts.error)}</div>`
    : "";

  const hiddenInputs = Object.entries(opts.hiddenFields)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("\n      ");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>utol-mcp — 認可リクエスト</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 420px; margin: 60px auto; padding: 0 16px; color: #1a1a1a; background: #fafafa; }
  h1 { font-size: 1.3rem; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 24px; }
  .error { background: #fee; border: 1px solid #c00; color: #900; padding: 8px 12px; border-radius: 4px; margin-bottom: 16px; }
  label { display: block; margin-top: 16px; font-weight: 600; }
  input[type="password"] { width: 100%; padding: 8px; margin-top: 4px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { margin-top: 20px; padding: 10px 24px; background: #2563eb; color: #fff; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; }
  button:hover { background: #1d4ed8; }
  .info { font-size: 0.85rem; color: #666; margin-top: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>utol-mcp 認可リクエスト</h1>
  ${errorHtml}
  <p><strong>${escapeHtml(opts.clientName ?? "不明なクライアント")}</strong> が utol-mcp へのアクセスを要求しています。</p>
  <p>要求スコープ:</p>
  <ul>${scopeList}</ul>
  <form method="POST" action="/authorize">
    ${hiddenInputs}
    <label for="passphrase">パスフレーズ</label>
    <input type="password" id="passphrase" name="passphrase" autocomplete="off" required autofocus>
    <button type="submit">承認</button>
  </form>
  <p class="info">このサーバーの管理者のみが承認できます。</p>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
