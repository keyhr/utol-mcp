import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { logger } from "./logger.js";
import { checkAuthStandalone, interactiveLogin, importCookies, logout } from "./browser/session.js";
import { UtolClient } from "./browser/client.js";
import { startServer } from "./mcp/server.js";

/**
 * utol-mcp の CLI エントリ。
 *   utol-mcp login        ブラウザで手動 SSO ログイン
 *   utol-mcp logout       ローカルセッション・キャッシュ削除
 *   utol-mcp auth-status  セッション有効性の確認
 *   utol-mcp serve        MCP サーバー（stdio）を起動（既定）
 */
export async function runCli(argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name("utol-mcp")
    .description("個人用ローカル実行の UTOL (UTokyo LMS) MCP サーバー")
    .version("0.1.0");

  program
    .command("login")
    .description("ブラウザを開き、UTokyo Account で手動ログインしてセッションを保存する")
    .option("--timeout <ms>", "ログイン待機のタイムアウト(ミリ秒)", (v) => Number(v))
    .action(async (opts: { timeout?: number }) => {
      const ok = await interactiveLogin({ timeoutMs: opts.timeout });
      if (!ok) {
        logger.error("ログインが完了しませんでした。もう一度 `utol-mcp login` を実行してください。");
        process.exitCode = 1;
      }
    });

  program
    .command("login-import")
    .description("Cookie JSON をインポートしてログインする（GUI 不要の代替手段）")
    .argument("<cookie-file>", "Playwright 形式の Cookie JSON ファイルパス")
    .action(async (cookieFile: string) => {
      const { readFile } = await import("node:fs/promises");
      const json = await readFile(cookieFile, "utf8");
      const ok = await importCookies(json);
      if (!ok) {
        logger.error("セッション確立に失敗しました。Cookie が有効か確認してください。");
        process.exitCode = 1;
      }
    });

  program
    .command("logout")
    .description("ローカルに保存したセッションとキャッシュを削除する")
    .action(async () => {
      await logout();
    });

  program
    .command("auth-status")
    .description("現在ログイン済みかどうかを確認する")
    .action(async () => {
      const ok = await checkAuthStandalone().catch((err) => {
        logger.error("確認中にエラーが発生しました", { message: String(err) });
        return false;
      });
      if (ok) {
        process.stdout.write("authenticated: true\n");
      } else {
        process.stdout.write("authenticated: false\n");
        process.stdout.write("`utol-mcp login` を実行してください。\n");
        process.exitCode = 1;
      }
    });

  program
    .command("dump")
    .description("[開発用] 認証済みページの HTML をファイルへ保存する（パーサ精緻化・スパイク用）")
    .argument("<path>", "UTOL のパス（例: /lms/timetable, /lms/task）")
    .argument("<outFile>", "保存先ファイルパス")
    .option("--render", "context.request ではなくブラウザ描画(page.goto)で取得する")
    .action(async (path: string, outFile: string, opts: { render?: boolean }) => {
      const client = new UtolClient();
      try {
        const html = opts.render ? await client.renderHtml(path) : await client.getHtml(path);
        await writeFile(outFile, html, "utf8");
        logger.info("保存しました", { outFile, bytes: Buffer.byteLength(html) });
      } catch (err) {
        logger.error("取得に失敗しました", {
          message: err instanceof Error ? err.message : String(err),
        });
        process.exitCode = 1;
      } finally {
        await client.close();
      }
    });

  program
    .command("serve", { isDefault: true })
    .description("MCP サーバーを起動する（既定: stdio、--http で HTTP モード）")
    .option("--http", "Streamable HTTP + OAuth モードで起動")
    .option("--port <n>", "HTTP ポート（既定 3000）", (v: string) => Number(v))
    .option("--host <h>", "HTTP バインドアドレス（既定 127.0.0.1）")
    .action(async (opts: { http?: boolean; port?: number; host?: string }) => {
      if (opts.http) {
        const { startHttpServer } = await import("./http/server.js");
        await startHttpServer({ port: opts.port, host: opts.host });
      } else {
        await startServer();
      }
    });

  await program.parseAsync(argv);
}
