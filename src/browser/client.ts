import type { BrowserContext, Page } from "playwright";
import { minRequestIntervalMs, utolUrl, UTOL_ORIGIN } from "../config.js";
import { AccessBoundaryError, NotAuthenticatedError } from "../errors.js";
import { launchContext, establishSession } from "./session.js";

/**
 * UTAS で取得を許可する URL のガードレール（シラバス参照フローのみ）。
 * これ以外の UTAS ページ（お知らせ KHW0001100 等）へはアクセスしない。
 */
const UTAS_SYLLABUS_HOST = "utas.adm.u-tokyo.ac.jp";
const UTAS_SYLLABUS_PATH = "/campusweb/campussquare.do";
const UTAS_SYLLABUS_FLOW = "SYW0001000-flow";

export function isAllowedUtasSyllabusUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.host !== UTAS_SYLLABUS_HOST) return false;
  if (u.pathname !== UTAS_SYLLABUS_PATH) return false;
  // シラバス参照フロー以外は不許可
  return u.searchParams.get("_flowId") === UTAS_SYLLABUS_FLOW;
}

/**
 * 認証済みセッションを再利用して UTOL から HTML を取得するクライアント。
 *
 * 設計方針:
 *  - 永続コンテキストを 1 つ保持し、全リクエストを直列化＋最小間隔でレート制限する
 *    （方針doc: 並列クロール・連続リクエストをしない）。
 *  - 期限切れ時 UTOL は SSO ログインページを HTTP 200 で返すため、
 *    全レスポンスを検査して未ログインを一元検出し NotAuthenticatedError を投げる
 *    （パーサに空データを渡さない／未ログイン HTML をキャッシュしない）。
 */
export class UtolClient {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  private authed = false;
  private pending = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * アイドル時にブラウザ（プロファイル）を解放するまでの待機時間(ms)。
   * これにより、複数の serve プロセスが同一プロファイルを長時間占有せず、競合を避ける。
   * 連続呼び出し中は保持したまま（＝バースト内はウォーム）。
   */
  private static readonly IDLE_CLOSE_MS = 15000;

  private async ensureContext(): Promise<BrowserContext> {
    if (!this.context) {
      this.context = await launchContext({ headless: true });
    }
    return this.context;
  }

  /** アイドル解放タイマーを（再）設定する。 */
  private armIdleClose(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.pending === 0) void this.close();
    }, UtolClient.IDLE_CLOSE_MS);
    // タイマーでプロセスの終了を妨げない
    this.idleTimer.unref?.();
  }

  /**
   * セッションを保証する。未確立なら（サイレント SSO を含めて）確立を試みる。
   * 対話が必要な場合は establishSession が false を返し、NotAuthenticatedError を投げる。
   */
  private async ensureAuth(): Promise<void> {
    if (this.authed) return;
    const context = await this.ensureContext();
    if (!this.page) this.page = context.pages()[0] ?? (await context.newPage());
    const ok = await establishSession(this.page);
    if (!ok) throw new NotAuthenticatedError();
    this.authed = true;
  }

  /** リクエストを直列化し、最小間隔を空けて実行する。 */
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const run = this.chain.then(async () => {
      const wait = this.lastRequestAt + minRequestIntervalMs() - Date.now();
      if (wait > 0) await delay(wait);
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    // チェーンはエラーでも途切れさせない
    this.chain = run.catch(() => undefined);
    const done = () => {
      this.pending--;
      if (this.pending === 0) this.armIdleClose(); // アイドルになったらプロファイルを解放
    };
    run.then(done, done);
    return run;
  }

  /**
   * 認証済み GET で HTML を取得する。
   * リダイレクト先や本文がログインページなら NotAuthenticatedError。
   */
  async getHtml(path: string): Promise<string> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      const url = utolUrl(path);
      let res = await context.request.get(url);
      let body = await res.text();
      // セッションが途中で失効した場合、サイレント SSO で一度だけ再確立して再試行
      if (looksLikeLoginPage(res.url(), body)) {
        this.authed = false;
        await this.ensureAuth();
        res = await context.request.get(url);
        body = await res.text();
        if (looksLikeLoginPage(res.url(), body)) {
          throw new NotAuthenticatedError();
        }
      }
      if (!res.ok()) {
        throw new Error(`GET ${path} が失敗しました (HTTP ${res.status()})`);
      }
      return body;
    });
  }

  /**
   * JS レンダリングが必要なページ向けフォールバック。
   * ページ遷移後の DOM を返す。
   * waitFor を指定すると、そのセレクタが出現するまで最大 timeout ms 待機する。
   */
  async renderHtml(path: string, opts?: { waitFor?: string; timeout?: number }): Promise<string> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      if (!this.page) this.page = context.pages()[0] ?? (await context.newPage());
      await this.page.goto(utolUrl(path), { waitUntil: "domcontentloaded" });
      if (looksLikeLoginPage(this.page.url(), "")) {
        throw new NotAuthenticatedError();
      }
      if (opts?.waitFor) {
        await this.page
          .waitForSelector(opts.waitFor, { timeout: opts.timeout ?? 10000 })
          .catch(() => {});
      }
      return await this.page.content();
    });
  }

  /**
   * コース検索フォームを送信して結果ページの HTML を返す。
   *
   * 検索はフォームの多数のデフォルトフィールドを含む必要があり、URL 直 GET では
   * 結果が描画されない。実フォーム #courseSearchForm を送信して再現する。
   */
  async searchCoursesHtml(criteria: {
    freeWord?: string;
    teacherName?: string;
    kougiName?: string;
    nendo?: number;
  }): Promise<string> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      if (!this.page) this.page = context.pages()[0] ?? (await context.newPage());
      const page = this.page;
      await page.goto(utolUrl("/course/search"), { waitUntil: "domcontentloaded", timeout: 60000 });
      if (looksLikeLoginPage(page.url(), "")) throw new NotAuthenticatedError();

      const fill = async (name: string, value?: string) => {
        if (value === undefined || value === "") return;
        await page.fill(`input[name=${name}]`, value).catch(() => {});
      };
      await fill("freeWord", criteria.freeWord);
      await fill("teacherName", criteria.teacherName);
      await fill("kougiName", criteria.kougiName);
      if (criteria.nendo) {
        await page.selectOption("select[name=nendo]", String(criteria.nendo)).catch(() => {});
      }

      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
        page.$eval("#courseSearchForm", (f) => (f as unknown as { submit: () => void }).submit()),
      ]);
      await page.waitForTimeout(800);
      return await page.content();
    });
  }

  /**
   * ガードレール付きで UTAS のシラバスページを取得する。
   * シラバス参照フロー（_flowId=SYW0001000-flow）以外の UTAS URL は拒否する。
   * UTAS へはサイレント SSO で入る（対話が必要なら NotAuthenticatedError）。
   */
  async getSyllabusHtml(utasUrl: string): Promise<string> {
    if (!isAllowedUtasSyllabusUrl(utasUrl)) {
      throw new AccessBoundaryError(
        "許可されていない URL です。UTAS のシラバス参照ページのみ取得できます。",
      );
    }
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      if (!this.page) this.page = context.pages()[0] ?? (await context.newPage());
      const page = this.page;
      await page.goto(utasUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      // UTAS へのサイレント SSO 収束を待つ
      const start = Date.now();
      while (Date.now() - start < 30000) {
        const u = page.url();
        if (u.startsWith("https://utas.adm.u-tokyo.ac.jp") && !/login|saml/i.test(u)) break;
        if (!u.startsWith("https://utas.adm.u-tokyo.ac.jp")) {
          const needs = await page
            .$("input[type=password], input[name=loginfmt], #i0116")
            .catch(() => null);
          if (needs) throw new NotAuthenticatedError();
        }
        await page.waitForTimeout(500);
      }
      if (!page.url().startsWith("https://utas.adm.u-tokyo.ac.jp")) {
        throw new NotAuthenticatedError();
      }
      return await page.content();
    });
  }

  /**
   * 教材ファイルを取得し、指定パスへ保存する（単一・オンデマンド）。
   * 実 UTOL の 2 段階 GET を再現する:
   *   1) GET /lms/course/make/tempfile?fileName&objectName&id=resourceId&idnumber → 一時 fileId
   *   2) GET /lms/course/material/setfiledown/<fileName>?fileName&fileId&resourceId&contentId&endDate → 本体
   */
  async downloadMaterial(m: {
    idnumber: string;
    fileName: string;
    objectName: string;
    resourceId: string;
    contentId: string;
    endDate?: string | null;
  }): Promise<{ bytes: number; buffer: Buffer }> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();

      // 1) 一時 fileId を取得
      const tempParams = new URLSearchParams({
        fileName: m.fileName,
        objectName: m.objectName,
        id: m.resourceId,
        idnumber: m.idnumber,
      });
      const tempRes = await context.request.get(utolUrl(`/lms/course/make/tempfile?${tempParams}`));
      const tempBody = await tempRes.text();
      if (looksLikeLoginPage(tempRes.url(), tempBody)) throw new NotAuthenticatedError();
      if (!tempRes.ok()) throw new Error(`一時ファイル準備に失敗 (HTTP ${tempRes.status()})`);
      const fileId = tempBody.trim();

      // 2) 本体を取得（フォーム #materialsSetDownFileForm の全フィールドを再現）
      const dlParams = new URLSearchParams({
        fileName: m.fileName,
        fileId,
        idnumber: m.idnumber,
        resourceId: m.resourceId,
        screen: "1",
        contentId: m.contentId,
        endDate: m.endDate ?? "",
      });
      const dlPath = `/lms/course/material/setfiledown/${encodeURIComponent(m.fileName)}?${dlParams}`;
      const res = await context.request.get(utolUrl(dlPath));
      const contentType = res.headers()["content-type"] ?? "";
      if (contentType.includes("text/html")) {
        const body = await res.text();
        if (looksLikeLoginPage(res.url(), body)) throw new NotAuthenticatedError();
      }
      if (!res.ok()) throw new Error(`ダウンロードに失敗しました (HTTP ${res.status()})`);
      const buffer = await res.body();
      return { bytes: buffer.byteLength, buffer };
    });
  }

  /**
   * 課題の「提出不要」フラグを変更する（可逆な状態変更）。
   * CSRF トークンを取得して POST /lms/task/changeNoSubmission を実行し、
   * 更新後の課題一覧 HTML を返す。
   */
  async changeTaskNoSubmission(params: {
    idnumber: string;
    contentsType: string;
    contentsId: string;
    noSubmission: boolean;
    csrf: string;
  }): Promise<string> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      const res = await context.request.post(utolUrl("/lms/task/changeNoSubmission"), {
        form: {
          _csrf: params.csrf,
          idnumber: params.idnumber,
          contentsType: params.contentsType,
          contentsId: params.contentsId,
          noSubmissionFlag: params.noSubmission ? "1" : "0",
        },
      });
      const body = await res.text();
      if (looksLikeLoginPage(res.url(), body)) throw new NotAuthenticatedError();
      if (!res.ok()) throw new Error(`状態変更に失敗しました (HTTP ${res.status()})`);
      return body;
    });
  }

  /**
   * 受講登録する（POST /lms/coursetop/enrollpaticipant）。
   * 登録可能なコースページから取得したフォーム値が必要。
   */
  async enrollCourse(f: {
    csrf: string;
    idnumber: string;
    rishunen: string;
    kougicd: string;
    kikancd: string;
  }): Promise<void> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      const res = await context.request.post(utolUrl("/lms/coursetop/enrollpaticipant"), {
        form: {
          _csrf: f.csrf,
          idnumber: f.idnumber,
          rishunen: f.rishunen,
          kougicd: f.kougicd,
          kikancd: f.kikancd,
        },
      });
      const body = await res.text();
      if (looksLikeLoginPage(res.url(), body)) throw new NotAuthenticatedError();
      if (!res.ok()) throw new Error(`受講登録に失敗しました (HTTP ${res.status()})`);
    });
  }

  /**
   * 受講登録を解除する（GET /lms/course/alldelete/<idnumber>）。
   */
  async unenrollCourse(idnumber: string): Promise<void> {
    return this.schedule(async () => {
      await this.ensureAuth();
      const context = await this.ensureContext();
      const res = await context.request.get(
        utolUrl(`/lms/course/alldelete/${encodeURIComponent(idnumber)}`),
      );
      const body = await res.text();
      if (looksLikeLoginPage(res.url(), body)) throw new NotAuthenticatedError();
      if (!res.ok()) throw new Error(`受講登録解除に失敗しました (HTTP ${res.status()})`);
    });
  }

  async close(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.context) {
      const ctx = this.context;
      this.context = null;
      this.page = null;
      this.authed = false; // 次回はコンテキスト再作成＋サイレント SSO 再確立
      await ctx.close().catch(() => {});
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * レスポンスがログイン／SSO ページかどうかを判定する。
 * UTOL は期限切れ時に SSO へリダイレクトし HTTP 200 を返しうるため、
 * URL と本文の両面で検査する。
 */
export function looksLikeLoginPage(finalUrl: string, html: string): boolean {
  // origin を外れている（IdP/SSO へ飛んだ）
  if (finalUrl && !finalUrl.startsWith(UTOL_ORIGIN)) return true;
  // UTOL 内のログインパス
  if (/\/login\b|\/saml\b/.test(finalUrl)) return true;
  // 本文中の典型マーカー
  if (html) {
    if (/UTokyo Account/i.test(html) && /(?:password|パスワード)/i.test(html)) return true;
    if (/shibboleth|SAMLRequest|idp\.he\.u-tokyo/i.test(html)) return true;
  }
  return false;
}
