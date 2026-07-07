import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AUTH_STATUS_TTL_MS, UTOL_PATHS } from "../config.js";
import { AccessBoundaryError, NotAuthenticatedError, UtolError } from "../errors.js";
import { logger } from "../logger.js";
import { nowJstIso } from "../util/datetime.js";
import type { UtolClient } from "../browser/client.js";
import type { CacheStore } from "../cache/store.js";
import { parseTimetable } from "../parsers/timetable.js";
import { parseTaskList, parseTaskCsrf } from "../parsers/taskList.js";
import { parseMessages } from "../parsers/messages.js";
import { parseEnrollForm } from "../parsers/course.js";
import { parseHeaderAnnouncements, parseHeaderUpdates } from "../parsers/header.js";
import { auditWrite } from "../audit.js";
import { parseCourse } from "../parsers/course.js";
import { parseSyllabus } from "../parsers/syllabus.js";
import { parseSearchResults } from "../parsers/search.js";
import { parseAssignment } from "../parsers/assignment.js";
import type { CourseSummary } from "../schemas/index.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export interface ToolDeps {
  client: UtolClient;
  cache: CacheStore;
}

/** 成功結果を JSON テキストとして返す。 */
function ok(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * OAuth スコープでツールが許可されているか検証する。
 * stdio 接続時は authInfo が存在しないためスキップする。
 */
function assertToolAllowed(toolName: string, extra: { authInfo?: AuthInfo }): void {
  if (!extra.authInfo) return;
  const scopes = extra.authInfo.scopes;
  if (scopes.length === 0) return;
  if (!scopes.includes(`tool:${toolName}`)) {
    throw new AccessBoundaryError(
      `ツール "${toolName}" はこのセッションでは許可されていません。認可時に許可するツールを選択してください。`,
    );
  }
}

/** エラーを「次に何をすべきか」を添えて返す。 */
function fail(err: unknown): CallToolResult {
  if (err instanceof NotAuthenticatedError) {
    return {
      isError: true,
      content: [{ type: "text", text: `${err.message}\n${err.hint}` }],
    };
  }
  if (err instanceof UtolError) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }
  const message = err instanceof Error ? err.message : String(err);
  logger.error("ツール実行エラー", { message });
  return { isError: true, content: [{ type: "text", text: `エラー: ${message}` }] };
}

/** 受講登録済みコース一覧を（キャッシュ優先で）取得する。 */
async function fetchCourses(deps: ToolDeps, force = false): Promise<CourseSummary[]> {
  return deps.cache.getOrFetch(
    "courses:timetable",
    async () => parseTimetable(await deps.client.getHtml(UTOL_PATHS.timetable)),
    { force },
  );
}

/**
 * 受講登録中コースであることを保証する（保護された内部コンテンツ向けガード）。
 * 受講登録外コースの内部ページ取得を方針上ブロックする。
 */
async function assertEnrolled(deps: ToolDeps, idnumber: string): Promise<void> {
  const courses = await fetchCourses(deps);
  if (!courses.some((c) => c.idnumber === idnumber)) {
    throw new AccessBoundaryError(
      `コース ${idnumber} は受講登録中の一覧に見つかりません。` +
        "受講登録外コースの教材・課題等の内部コンテンツは取得できません（公開情報はシラバス/検索を利用してください）。",
    );
  }
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  // --- auth_status ---
  server.tool(
    "auth_status",
    "UTOL にログイン済みかを確認する。未ログインなら手動ログインを案内する（自動ログインはしない）。",
    {},
    async (_args, extra) => {
      try {
        assertToolAllowed("auth_status", extra);
        const authenticated = await deps.cache.getOrFetch(
          "auth:status",
          async () => {
            await deps.client.getHtml(UTOL_PATHS.timetable);
            return true;
          },
          { ttlMs: AUTH_STATUS_TTL_MS },
        ).catch((err) => {
          if (err instanceof NotAuthenticatedError) return false;
          throw err;
        });
        return ok({
          authenticated,
          checkedAt: nowJstIso(),
          hint: authenticated ? null : "ターミナルで `utol-mcp login` を実行してください。",
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- list_courses ---
  server.tool(
    "list_courses",
    "受講登録している講義（時間割）の一覧を取得する。",
    {
      refresh: z.boolean().optional().describe("true でキャッシュを無視して再取得"),
    },
    async ({ refresh }, extra) => {
      try {
        assertToolAllowed("list_courses", extra);
        const courses = await fetchCourses(deps, refresh === true);
        // 出力を軽量化（コンテキスト膨張を防ぐ）
        return ok(
          courses.map((c) => ({
            idnumber: c.idnumber,
            name: c.name,
            teachers: c.teachers,
            day: c.dayPeriod?.day ?? null,
            year: c.year,
            url: c.url,
          })),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- get_course ---
  server.tool(
    "get_course",
    "講義の詳細（お知らせ・教材一覧・課題一覧）を取得する。受講登録中コースのみ。",
    {
      idnumber: z.string().describe("コースの idnumber（例: 2025_0340_FEN-EE3902E1_01）"),
      refresh: z.boolean().optional(),
    },
    async ({ idnumber, refresh }, extra) => {
      try {
        assertToolAllowed("get_course", extra);
        await assertEnrolled(deps, idnumber);
        const detail = await deps.cache.getOrFetch(
          `course:${idnumber}`,
          async () =>
            parseCourse(
              await deps.client.getHtml(
                `${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
              ),
              idnumber,
            ),
          { force: refresh === true },
        );
        // 出力を軽量化: download_material は内部で resourceId から再取得するため、
        // ここでは要点のみ返す（objectName 等の内部パスは出力しない）。
        return ok({
          idnumber: detail.idnumber,
          name: detail.name,
          teachers: detail.teachers,
          syllabusUrl: detail.syllabusUrl,
          url: detail.url,
          announcements: detail.announcements,
          materials: detail.materials.map((m) => ({
            title: m.title,
            resourceId: m.resourceId,
            updatedAt: m.updatedAt,
          })),
          assignments: detail.assignments.map((a) => ({
            title: a.title,
            kind: a.kind,
            dueAt: a.dueAt,
            submitted: a.submitted,
            contentsId: a.contentsId,
            url: a.url,
          })),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- list_assignments ---
  server.tool(
    "list_assignments",
    "全科目横断の課題・テスト一覧と締切を取得する。",
    { refresh: z.boolean().optional() },
    async ({ refresh }, extra) => {
      try {
        assertToolAllowed("list_assignments", extra);
        const tasks = await deps.cache.getOrFetch(
          "tasks:all",
          async () => parseTaskList(await deps.client.getHtml(UTOL_PATHS.task)),
          { force: refresh === true },
        );
        return ok(tasks);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- get_assignment ---
  server.tool(
    "get_assignment",
    "課題の詳細（説明・締切・添付・提出状況）を取得する。読み取りのみ・受講登録済みコースのみ。",
    {
      idnumber: z.string().describe("コースの idnumber"),
      url: z.string().describe("課題詳細ページの URL（list_assignments/get_course の url）"),
    },
    async ({ idnumber, url }, extra) => {
      try {
        assertToolAllowed("get_assignment", extra);
        await assertEnrolled(deps, idnumber);
        const html = await deps.client.renderHtml(toPath(url), { waitFor: ".ql-editor" });
        return ok(parseAssignment(html, idnumber));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- get_syllabus ---
  server.tool(
    "get_syllabus",
    "シラバスを取得する（UTAS のシラバス参照ページ）。公開情報のため受講登録外コースも取得可。" +
      "受講登録済みコースは idnumber のみで可。受講登録外コースは search_courses が返す syllabusUrl を渡す。",
    {
      idnumber: z.string().describe("コースの idnumber"),
      syllabusUrl: z
        .string()
        .optional()
        .describe("UTAS シラバス URL（search_courses の syllabusUrl）。受講登録外コースはこちらを渡す。"),
    },
    async ({ idnumber, syllabusUrl }, extra) => {
      try {
        assertToolAllowed("get_syllabus", extra);
        // 受講登録済みコースは、コースページから UTAS シラバスリンクを取得する。
        let url = syllabusUrl;
        if (!url) {
          const course = await deps.cache.getOrFetch(`course:${idnumber}`, async () =>
            parseCourse(
              await deps.client.getHtml(
                `${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
              ),
              idnumber,
            ),
          );
          if (!course.syllabusUrl) {
            throw new UtolError(
              "このコースのシラバスリンクが見つかりません。受講登録外の場合は search_courses の syllabusUrl を指定してください。",
            );
          }
          url = course.syllabusUrl;
        }
        const syllabus = await deps.cache.getOrFetch(`syllabus:${idnumber}`, async () =>
          parseSyllabus(await deps.client.getSyllabusHtml(url!), idnumber, url!),
        );
        return ok(syllabus);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- search_courses ---
  server.tool(
    "search_courses",
    "UTOL のコース検索。受講登録外コースも対象だが、返却は公開カタログ情報（名称・教員・開講期・開講組織・概要・リンク）のみ。",
    {
      keyword: z.string().optional().describe("フリーワード（コース名・教員名・概要）"),
      teacher: z.string().optional().describe("教員名"),
      year: z.number().int().optional().describe("開講年度"),
      limit: z.number().int().min(1).max(100).optional().describe("最大件数（既定30）"),
    },
    async (args, extra) => {
      try {
        assertToolAllowed("search_courses", extra);
        // 注: 検索は POST + 隠しフォームトークンの可能性が高い。
        // 技術検証スパイクで実エンドポイントとパラメータを確定し、ここを実装する。
        const results = await searchCourses(deps, args);
        const limit = args.limit ?? 30;
        return ok(results.slice(0, limit));
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- download_material ---
  server.tool(
    "download_material",
    "教材ファイルを単一・オンデマンドで取得する。大量DL不可。受講登録済みコースのみ。" +
      "get_course の materials[].resourceId で対象教材を指定する。" +
      "destPath を指定するとローカルへ保存し、省略するとレスポンスにファイル内容を含めて返す（リモートLLM向け）。",
    {
      idnumber: z.string().describe("コースの idnumber"),
      resourceId: z.string().describe("教材の resourceId（get_course の materials[].resourceId）"),
      destPath: z.string().optional().describe("保存先の絶対パス（省略するとファイル内容をインラインで返す）"),
    },
    async ({ idnumber, resourceId, destPath }, extra) => {
      try {
        assertToolAllowed("download_material", extra);
        await assertEnrolled(deps, idnumber);
        const course = await deps.cache.getOrFetch(`course:${idnumber}`, async () =>
          parseCourse(
            await deps.client.getHtml(
              `${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
            ),
            idnumber,
          ),
        );
        const material = course.materials.find((m) => m.resourceId === resourceId);
        if (!material) {
          throw new UtolError(`resourceId=${resourceId} の教材が見つかりません。`);
        }
        if (!material.fileName || !material.objectName || !material.contentId) {
          throw new UtolError("この教材はダウンロードに必要な情報を欠いています。");
        }
        const { bytes, buffer } = await deps.client.downloadMaterial(
          {
            idnumber,
            fileName: material.fileName,
            objectName: material.objectName,
            resourceId,
            contentId: material.contentId,
            endDate: material.openEndDate,
          },
          destPath,
        );
        if (destPath) {
          return ok({ saved: destPath, bytes, fileName: material.fileName });
        }
        const mimeType = guessMimeType(material.fileName);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ fileName: material.fileName, bytes, mimeType }) },
            {
              type: "resource" as const,
              resource: {
                uri: `utol://material/${encodeURIComponent(idnumber)}/${encodeURIComponent(resourceId)}/${encodeURIComponent(material.fileName)}`,
                mimeType,
                blob: buffer.toString("base64"),
              },
            },
          ],
        };
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- list_announcements （時間割ヘッダーの吹き出し＝お知らせ） ---
  server.tool(
    "list_announcements",
    "お知らせ一覧を取得する（時間割ヘッダー左上の吹き出しアイコン）。",
    { refresh: z.boolean().optional() },
    async ({ refresh }, extra) => {
      try {
        assertToolAllowed("list_announcements", extra);
        const items = await deps.cache.getOrFetch(
          "announcements:header",
          async () => parseHeaderAnnouncements(await deps.client.getHtml(UTOL_PATHS.timetable)),
          { force: refresh === true },
        );
        return ok(items);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- list_updates （時間割ヘッダーのベル＝更新情報・最近の活動） ---
  server.tool(
    "list_updates",
    "更新情報（最近の活動）を取得する（時間割ヘッダー左上のベルアイコン）。教材追加・課題追加・提出・お知らせ等の通知。",
    { refresh: z.boolean().optional() },
    async ({ refresh }, extra) => {
      try {
        assertToolAllowed("list_updates", extra);
        const items = await deps.cache.getOrFetch(
          "updates:header",
          async () => parseHeaderUpdates(await deps.client.getHtml(UTOL_PATHS.timetable)),
          { force: refresh === true },
        );
        return ok(items);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- list_messages ---
  server.tool(
    "list_messages",
    "メッセージ一覧（UTOL のメッセージ＝inquiry）を取得する。一覧のメタ情報のみで本文は含まない。",
    { refresh: z.boolean().optional() },
    async ({ refresh }, extra) => {
      try {
        assertToolAllowed("list_messages", extra);
        const messages = await deps.cache.getOrFetch(
          "messages:all",
          async () => parseMessages(await deps.client.getHtml("/lms/inquiry_list")),
          { force: refresh === true },
        );
        return ok(messages);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // --- set_task_no_submission （書き込み操作・ガードレール付き） ---
  server.tool(
    "set_task_no_submission",
    "課題の「提出不要」フラグを変更する（提出不要⇔未提出、可逆）。" +
      "【書き込み操作】confirm:true が無い場合は実行せずプレビューを返す。実行は監査ログに記録される。",
    {
      idnumber: z.string().describe("コースの idnumber"),
      contentsId: z.string().describe("課題の contentsId（list_assignments の contentsId または id）"),
      noSubmission: z.boolean().describe("true=提出不要にする / false=未提出に戻す"),
      contentsType: z.string().optional().describe("既定は list_assignments の contentsType（通常 '1'）"),
      confirm: z.boolean().optional().describe("true で実際に変更を実行。省略時はプレビューのみ。"),
    },
    async ({ idnumber, contentsId, noSubmission, contentsType, confirm }, extra) => {
      try {
        assertToolAllowed("set_task_no_submission", extra);
        await assertEnrolled(deps, idnumber);
        const listHtml = await deps.client.getHtml(UTOL_PATHS.task);
        const tasks = parseTaskList(listHtml);
        const target = tasks.find(
          (t) => t.contentsId === contentsId && (t.courseIdnumber === idnumber || !t.courseIdnumber),
        );
        const resolvedType = contentsType ?? target?.contentsType ?? "1";

        const preview = {
          action: "set_task_no_submission",
          target: {
            idnumber,
            contentsId,
            contentsType: resolvedType,
            title: target?.title ?? "(一覧に見つかりません)",
            course: target?.courseName ?? null,
            currentNoSubmission: target?.noSubmission ?? null,
          },
          willChangeTo: { noSubmission },
          reversible: true,
          reversibleNote: "この操作は可逆です（提出不要⇔未提出）。再実行で元に戻せます。",
        };

        if (confirm !== true) {
          return ok({
            preview: true,
            note: "これはプレビューです。実行するには confirm:true を指定してください。",
            ...preview,
          });
        }

        const csrf = parseTaskCsrf(listHtml);
        if (!csrf) throw new UtolError("CSRF トークンを取得できませんでした。");
        const updatedHtml = await deps.client.changeTaskNoSubmission({
          idnumber,
          contentsType: resolvedType,
          contentsId,
          noSubmission,
          csrf,
        });
        const updated = parseTaskList(updatedHtml).find((t) => t.contentsId === contentsId);
        await auditWrite({
          action: "set_task_no_submission",
          target: { idnumber, contentsId, contentsType: resolvedType, noSubmission },
          result: "ok",
        });
        // 変更後の一覧をキャッシュ更新
        await deps.cache.set("tasks:all", parseTaskList(updatedHtml));
        return ok({
          done: true,
          ...preview,
          newNoSubmission: updated?.noSubmission ?? noSubmission,
        });
      } catch (err) {
        await auditWrite({
          action: "set_task_no_submission",
          target: { idnumber, contentsId },
          result: "error",
          detail: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        return fail(err);
      }
    },
  );

  // --- register_course （書き込み操作・ガードレール付き） ---
  server.tool(
    "register_course",
    "コースを受講登録する。【書き込み操作・受講登録（UTOL上のデータ）に影響】confirm:true が無い場合はプレビューのみ。実行は監査ログに記録。可逆（unregister_course で解除可能）。",
    {
      idnumber: z.string().describe("登録するコースの idnumber（search_courses で取得）"),
      confirm: z.boolean().optional().describe("true で実際に登録を実行。省略時はプレビューのみ。"),
    },
    async ({ idnumber, confirm }, extra) => {
      try {
        assertToolAllowed("register_course", extra);
        // 対象コースページから登録フォーム（可能な場合のみ存在）を取得
        const html = await deps.client.getHtml(
          `${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
        );
        const form = parseEnrollForm(html);
        if (!form) {
          throw new UtolError(
            "このコースは受講登録できません（既に受講登録済み、または登録不可のコースです）。",
          );
        }
        const preview = {
          action: "register_course",
          target: { idnumber, kougicd: form.kougicd, rishunen: form.rishunen },
          reversible: true,
          reversibleNote: "この操作は unregister_course で解除できますが、受講登録（UTOL上のデータ）に影響します。",
        };
        if (confirm !== true) {
          return ok({ preview: true, note: "実行するには confirm:true を指定してください。", ...preview });
        }
        await deps.client.enrollCourse(form);
        await auditWrite({ action: "register_course", target: { idnumber }, result: "ok" });
        await fetchCourses(deps, true); // 受講登録一覧キャッシュを更新
        return ok({ done: true, ...preview });
      } catch (err) {
        await auditWrite({
          action: "register_course",
          target: { idnumber },
          result: "error",
          detail: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        return fail(err);
      }
    },
  );

  // --- unregister_course （書き込み操作・ガードレール付き） ---
  server.tool(
    "unregister_course",
    "コースの受講登録を解除する。【書き込み操作・受講登録（UTOL上のデータ）に影響／要注意】confirm:true が無い場合はプレビューのみ。実行は監査ログに記録。",
    {
      idnumber: z.string().describe("解除するコースの idnumber"),
      confirm: z.boolean().optional().describe("true で実際に解除を実行。省略時はプレビューのみ。"),
    },
    async ({ idnumber, confirm }, extra) => {
      try {
        assertToolAllowed("unregister_course", extra);
        await assertEnrolled(deps, idnumber);
        const courses = await fetchCourses(deps);
        const target = courses.find((c) => c.idnumber === idnumber);
        const preview = {
          action: "unregister_course",
          target: { idnumber, name: target?.name ?? null },
          reversible: false,
          reversibleNote:
            "受講登録解除は提出物等のコースデータ喪失につながる可能性があります。再登録で戻せない場合があるため慎重に判断してください。",
        };
        if (confirm !== true) {
          return ok({ preview: true, note: "実行するには confirm:true を指定してください。", ...preview });
        }
        await deps.client.unenrollCourse(idnumber);
        await auditWrite({ action: "unregister_course", target: { idnumber }, result: "ok" });
        await fetchCourses(deps, true);
        return ok({ done: true, ...preview });
      } catch (err) {
        await auditWrite({
          action: "unregister_course",
          target: { idnumber },
          result: "error",
          detail: err instanceof Error ? err.message : String(err),
        }).catch(() => {});
        return fail(err);
      }
    },
  );

  // --- refresh_cache ---
  server.tool(
    "refresh_cache",
    "主要な一覧（受講登録コース・課題一覧）を再取得してキャッシュを更新する。",
    {},
    async (_args, extra) => {
      try {
        assertToolAllowed("refresh_cache", extra);
        const [courses, tasks] = await Promise.all([
          fetchCourses(deps, true),
          deps.cache.getOrFetch(
            "tasks:all",
            async () => parseTaskList(await deps.client.getHtml(UTOL_PATHS.task)),
            { force: true },
          ),
        ]);
        return ok({ courses: courses.length, tasks: tasks.length, refreshedAt: nowJstIso() });
      } catch (err) {
        return fail(err);
      }
    },
  );
}

/**
 * コース検索の実行。
 * 実エンドポイント: GET /course/search（form#courseSearchForm, method=get）。
 * 実フィールド名: kougiName(講義名)/teacherName(教員名)/freeWord(フリーワード)/
 *   nendo(年度)/yobiType(曜日)/jigenCd(時限)/termType(開講期) 等。
 *
 * 注意(spike): 最小パラメータでは結果が描画されないケースを確認済み。
 * フォームの必須パラメータ（term[]/section[] 等）を含める調整が必要な場合があるため、
 * 結果が空のときは renderHtml フォールバックも検討する。
 */
async function searchCourses(
  deps: ToolDeps,
  args: { keyword?: string; teacher?: string; year?: number },
) {
  // URL 直 GET では結果が描画されないため、実フォームを送信する。
  const html = await deps.client.searchCoursesHtml({
    freeWord: args.keyword,
    teacherName: args.teacher,
    nendo: args.year,
  });
  return parseSearchResults(html);
}

/** 絶対 URL を UTOL のパス（+クエリ）へ変換する。 */
function toPath(urlOrPath: string): string {
  try {
    const u = new URL(urlOrPath);
    return u.pathname + u.search;
  } catch {
    return urlOrPath;
  }
}

const MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
};

function guessMimeType(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}
