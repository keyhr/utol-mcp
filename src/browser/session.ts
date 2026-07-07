import { chmod, mkdir, rm } from "node:fs/promises";
import {
  chromium,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  browserProfileDir,
  cacheDir,
  dataDir,
  utolUrl,
  UTOL_ORIGIN,
  UTOL_PATHS,
} from "../config.js";
import { logger } from "../logger.js";

/**
 * ローカルデータディレクトリ（~/.utol-mcp）を権限 700 で用意する。
 * セッションとキャッシュを含むため、ルートごと本人のみアクセス可とする。
 */
export async function ensureDataDir(): Promise<void> {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  // recursive 作成時に既存ディレクトリの権限は変わらないため明示的に締める
  await chmod(dataDir(), 0o700).catch(() => {});
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
}

/**
 * 永続コンテキストを起動する。
 * headless=false は手動ログイン用。それ以外は読み取り再利用用。
 *
 * 注意: Chromium の永続プロファイルは同時に 1 プロセスしか開けない。
 * すでに別プロセス（serve 等）が掴んでいる場合は launch が失敗するため、
 * 呼び出し側で分かりやすいエラーへ変換する。
 */
export async function launchContext(opts: {
  headless: boolean;
  /** プロファイル競合時に他プロセスの解放を待つ最大時間(ms)。既定 20 秒。 */
  lockWaitMs?: number;
}): Promise<BrowserContext> {
  await ensureDataDir();
  const deadline = Date.now() + (opts.lockWaitMs ?? 20000);
  let lastErr: unknown;
  // プロファイルは同時 1 プロセスのみ。競合時は指数バックオフで待って再試行する
  // （複数 serve プロセスが並存しても、呼び出しを直列化して破綻を避ける）。
  for (let attempt = 0; ; attempt++) {
    try {
      return await chromium.launchPersistentContext(browserProfileDir(), {
        headless: opts.headless,
        // 方針doc準拠: stealth や bot 検知回避は行わない。既定の Playwright 挙動のまま。
        viewport: { width: 1280, height: 900 },
        args: ["--hide-crash-restore-bubble"],
      });
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      const isLock = /SingletonLock|ProcessSingleton|already (?:in use|running)|Failed to create/i.test(
        message,
      );
      if (!isLock || Date.now() >= deadline) break;
      const backoff = Math.min(2000, 300 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  if (/SingletonLock|ProcessSingleton|already (?:in use|running)|Failed to create/i.test(message)) {
    throw new Error(
      "ブラウザプロファイルが他プロセスで使用中のため取得できませんでした（待機タイムアウト）。" +
        "少し待って再試行してください（Claude Code の再起動は不要です）。",
    );
  }
  throw lastErr;
}

/**
 * 現在ログイン済みかを、与えられたページで判定する。
 * 期限切れ時 UTOL は SSO ログインページへ遷移する（URL が utol origin 外／/login）。
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  // UTOL origin 外（SSO/IdP）にいる場合は未ログイン
  if (!url.startsWith(utolUrl(""))) return false;
  // /login や /saml 配下は未ログイン
  if (/\/login\b|\/saml\b/.test(url)) return false;
  // 時間割の主要要素が存在すればログイン済みとみなす
  const marker = await page
    .$("#selectTimetable, .timetable, [class*='timetable']")
    .catch(() => null);
  return marker !== null;
}

/**
 * headed ブラウザを開き、ユーザーの手動 SSO ログインを待つ。
 * ツールは資格情報を一切代理入力しない。
 *
 * @returns ログインに成功したら true
 */
export async function interactiveLogin(opts?: {
  timeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000;
  const context = await launchContext({ headless: false });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(utolUrl(UTOL_PATHS.timetable), { waitUntil: "domcontentloaded" });

    logger.info(
      "ブラウザで UTokyo Account にログインしてください（このツールは資格情報を入力しません）。",
    );

    const start = Date.now();
    // 1 秒間隔でログイン成立をポーリング
    while (Date.now() - start < timeoutMs) {
      if (await isLoggedIn(page).catch(() => false)) {
        logger.info("ログインを確認しました。セッションを保存します。");
        return true;
      }
      await page.waitForTimeout(1000);
    }
    logger.warn("時間内にログインが確認できませんでした。");
    return false;
  } finally {
    // 永続コンテキストを閉じると Cookie は userDataDir に保存される（想定）。
    // ※この永続化が SAML セッション Cookie でも成立するかは技術検証スパイクで確認する。
    await context.close();
  }
}

/**
 * ページ上でセッションを確立する。
 *
 * 1. 時間割へアクセスし、既にログイン済みなら成功。
 * 2. 未ログインなら SSO エントリ（/saml/login?disco=true）へ遷移し、
 *    **対話なしのサイレント SSO** でアプリセッションが再確立されるのを待つ。
 * 3. 途中で資格情報・MFA・アカウント選択が要求されたら、対話せず false を返す
 *    （方針doc準拠。呼び出し側は手動ログインを促す）。
 *
 * @returns ログイン済みになれば true
 */
export async function establishSession(
  page: Page,
  opts?: { timeoutMs?: number },
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 30000;

  await page.goto(utolUrl(UTOL_PATHS.timetable), { waitUntil: "domcontentloaded", timeout: 60000 });
  if (await isLoggedIn(page).catch(() => false)) return true;

  // サイレント SSO を試みる
  await page
    .goto(utolUrl(UTOL_PATHS.samlLogin), { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch(() => {});

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    // UTOL に戻り、ログインページでなければ成立とみなす
    if (url.startsWith(UTOL_ORIGIN) && !/\/login\b|\/saml\b/.test(url)) break;
    // IdP 側で対話が要求されているなら、触れずに中止（SSO/MFA を回避しない）
    if (!url.startsWith(UTOL_ORIGIN)) {
      const needsInteraction = await page
        .$("input[type=password], input[name=loginfmt], #i0116, #i0118, .tile-container, [data-test-id='accountTile']")
        .catch(() => null);
      if (needsInteraction) {
        logger.warn("SSO で対話が必要です。手動ログインが必要です。");
        return false;
      }
    }
    await page.waitForTimeout(500);
  }

  return await isLoggedIn(page).catch(() => false);
}

/**
 * headless でセッションの有効性を確認する（サイレント SSO 再認証を含む）。
 * serve 実行中はプロファイル同時使用を避けるため、serve を停止してから実行すること。
 */
export async function checkAuthStandalone(): Promise<boolean> {
  const context = await launchContext({ headless: true });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    return await establishSession(page);
  } finally {
    await context.close();
  }
}

/**
 * Cookie JSON 文字列をインポートし、UTOL セッションを確立する。
 * GUI なしでログインするための代替手段。
 *
 * cookies は Playwright の Cookie 形式の JSON 配列:
 *   [{ name, value, domain, path, ... }, ...]
 */
export async function importCookies(cookiesJson: string): Promise<boolean> {
  const cookies = JSON.parse(cookiesJson) as Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    expires?: number;
  }>;

  const context = await launchContext({ headless: true });
  try {
    await context.addCookies(cookies);
    const page = context.pages()[0] ?? (await context.newPage());
    const ok = await establishSession(page);
    if (ok) {
      logger.info("Cookie インポートによるセッション確立に成功しました。");
    } else {
      logger.warn("Cookie をインポートしましたが、セッション確立に失敗しました。Cookie が有効か確認してください。");
    }
    return ok;
  } finally {
    await context.close();
  }
}

/**
 * ローカルのセッション情報とキャッシュを削除する。
 */
export async function logout(): Promise<void> {
  await rm(browserProfileDir(), { recursive: true, force: true });
  await rm(cacheDir(), { recursive: true, force: true });
  logger.info("セッションとキャッシュを削除しました。");
}
