import type { AssignmentDetail, Material } from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, extractIdnumber, load } from "./util.js";

/**
 * 課題詳細ページ（/lms/course/report/submission）を抽出する（読み取りのみ）。
 * 提出フォームには触れない。タイトル・説明・締切・添付・提出状況を拾う。
 *
 * 実 HTML 構造（2026 時点で確認）:
 *   dl.course-header-detail 内に div.contents-detail.contents-vertical が並ぶ。
 *   各 div: dt.contents-header（ラベル）+ dd.contents-input-area（値）。
 *   - タイトル: dt「タイトル」→ dd 内 div テキスト
 *   - 内容: dt「内容」→ dd 内 #bodyEditor .ql-editor（Quill 描画、JS 実行が必要）
 *   - 添付ファイル: dt「添付ファイル」→ dd 内 a[href] リンク群
 *   - 提出期間: dt「提出期間」→ dd 内 span 群（開始 ～ 終了）
 *   - 期間外提出: dt「期間外提出」→ dd 内 div テキスト
 *   h1.course-title-txt = コース名、h1.contents-title-txt = 「課題提出」固定
 */
export function parseAssignment(html: string, courseIdnumber?: string): AssignmentDetail {
  const $ = load(html);

  const courseName = cleanText($("h1.course-title-txt").first().text()) || null;

  // dl.course-header-detail 内のラベル付きフィールドを走査
  const fields = new Map<string, ReturnType<typeof $>>();
  $("dl.course-header-detail .contents-detail").each((_, el) => {
    const $el = $(el);
    const label = cleanText($el.find("dt").first().text());
    if (label) fields.set(label, $el.find("dd").first());
  });

  const title = cleanText(fields.get("タイトル")?.text() ?? "") || null;

  // 内容: Quill エディタ (.ql-editor) の描画済みテキストを取得
  const $descDd = fields.get("内容");
  const description = $descDd
    ? extractQuillText($descDd) || cleanText($descDd.text()) || null
    : null;

  // 提出期間: "2026/06/25 13:10 ～ 2026/07/17 17:00" のような形式
  const periodText = cleanText(fields.get("提出期間")?.text() ?? "");
  const [openRaw, dueRaw] = splitPeriod(periodText);

  // 添付ファイル
  const attachments: Material[] = [];
  fields.get("添付ファイル")?.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const t = cleanText($el.text());
    if (!t) return;
    attachments.push({
      title: t,
      resourceId: param(href, "resourceId"),
      contentId: param(href, "contentId"),
      fileId: param(href, "fileId"),
      fileName: param(href, "fileName"),
      objectName: null,
      openEndDate: null,
      downloadUrl: absoluteUrl(href),
      updatedAt: null,
    });
  });

  // 提出状況: ボタンのクラスまたはページテキストから推定
  const submitted = $(".notSubmit").length > 0 ? false : inferSubmitted($.root().text());

  return {
    id: null,
    courseIdnumber: courseIdnumber ?? extractIdnumber($.html() ?? ""),
    courseName,
    title: title || "(無題の課題)",
    kind: /テスト|test/i.test(title ?? "") ? "test" : "assignment",
    dueAt: normalizeJstDateTime(dueRaw),
    openAt: normalizeJstDateTime(openRaw),
    submitted,
    contentsType: null,
    contentsId: null,
    noSubmission: null,
    description,
    attachments,
    url: null,
  };
}

/** Quill エディタ内のテキストをブロック要素ごとに改行して抽出する。 */
function extractQuillText($dd: ReturnType<ReturnType<typeof load>>): string | null {
  const $editor = $dd.find(".ql-editor");
  if ($editor.length === 0) return null;
  const html = $editor.html() ?? "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|ol|ul|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** "2026/06/25 13:10 ～ 2026/07/17 17:00" → [open, due] */
function splitPeriod(text: string): [string | null, string | null] {
  const m = text.match(/^(.+?)\s*[～~〜]\s*(.+)$/);
  if (m) return [m[1]!.trim(), m[2]!.trim()];
  return [null, text || null];
}

function param(href: string, key: string): string | null {
  const m = href.match(new RegExp(`${key}=([^&"'\\s]+)`));
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function inferSubmitted(text: string): boolean | null {
  if (/提出済|submitted|受付完了/i.test(text)) return true;
  if (/未提出|not submitted/i.test(text)) return false;
  return null;
}
