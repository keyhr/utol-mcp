import type { AssignmentSummary, AssignmentKind } from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, extractIdnumber, load } from "./util.js";

/**
 * 課題・テスト一覧ページ（/lms/task）から全科目横断の課題を抽出する。
 *
 * 実 HTML 構造（2026 時点で確認）: 行ごとに以下の兄弟セルが並ぶ。
 *   .tasklist-title   -> <a class="link-txt title" href="/lms/course/report/submission?idnumber=..&reportId=..">課題名</a>
 *   .tasklist-deadline-> <span>開始</span> ～ <span class="deadline">終了(締切)</span>
 *   .tasklist-status  -> <a ... data-idnumber data-contentid>未提出/提出済</a>
 *   .tasklist-course  -> コース名
 * ヘッダ行（.bold-txt.sortable）は除外する。
 */
export function parseTaskList(html: string): AssignmentSummary[] {
  const $ = load(html);
  const results: AssignmentSummary[] = [];

  $(".tasklist-title").each((_, el) => {
    const $title = $(el);
    // ヘッダ行（ソート見出し）は除外
    if ($title.hasClass("bold-txt") || $title.hasClass("sortable")) return;
    const $link = $title.find("a").first();
    const title = cleanText($link.find("span").first().text() || $link.text() || $title.text());
    if (!title) return;

    const href = $link.attr("href") ?? "";
    const $row = $title.parent();

    // 締切: .tasklist-deadline 内の .deadline（終了時刻）を優先、無ければ最後の日時
    const $deadline = $row.find(".tasklist-deadline").first();
    const dueRaw =
      cleanText($deadline.find(".deadline").first().text()) ||
      cleanText($deadline.find("span").last().text());

    const $status = $row.find(".tasklist-status").first();
    const statusText = cleanText($status.text());
    const $statusLink = $status.find("[data-idnumber], [data-contentid]").first();
    const dataIdnumber = $statusLink.attr("data-idnumber");
    const dataContentId = $statusLink.attr("data-contentid");
    const dataContentsType = $statusLink.attr("data-contentstype");
    // 現在「提出不要」かはステータス文言で判定する
    // （data-nosubmissionflag は現在状態を表さず、onclick 側も未使用のため）。

    const courseName = cleanText($row.find(".tasklist-course").first().text()) || null;

    results.push({
      id: extractTaskId(href) ?? dataContentId ?? null,
      courseIdnumber: extractIdnumber(href) ?? dataIdnumber ?? null,
      courseName,
      title,
      kind: inferKind(href),
      dueAt: normalizeJstDateTime(dueRaw),
      submitted: inferSubmitted(statusText),
      contentsType: dataContentsType ?? null,
      contentsId: dataContentId ?? extractTaskId(href) ?? null,
      noSubmission: /提出不要/.test(statusText) ? true : statusText ? false : null,
      url: absoluteUrl(href),
    });
  });

  return dedupe(results);
}

/** /lms/task ページから CSRF トークンを抽出する（状態変更 POST に必要）。 */
export function parseTaskCsrf(html: string): string | null {
  const $ = load(html);
  return (
    $("#onlineCourseForm input[name='_csrf']").attr("value") ??
    $("input[name='_csrf']").first().attr("value") ??
    null
  );
}

function extractTaskId(href: string): string | null {
  const m = href.match(/(?:reportId|testId|examinationId|questionnaireId|surveyId)=([^&]+)/);
  return m && m[1] ? m[1] : null;
}

function inferKind(href: string): AssignmentKind {
  // href のパスで判定する（title セルの class は種別を表さない）。
  if (/\/examination\/|examinationId=/i.test(href)) return "test";
  if (/\/surveys\/|\/questionnaire|questionnaireId=|surveyId=/i.test(href)) return "questionnaire";
  if (/\/report\/|reportId=/i.test(href)) return "assignment";
  return "unknown";
}

function inferSubmitted(text: string): boolean | null {
  if (/提出済|回答済|提出完了|受付完了/.test(text)) return true;
  if (/未提出|未回答|noSubmission/i.test(text)) return false;
  return null;
}

function dedupe(items: AssignmentSummary[]): AssignmentSummary[] {
  const seen = new Set<string>();
  const out: AssignmentSummary[] = [];
  for (const it of items) {
    const key = `${it.courseIdnumber ?? ""}|${it.id ?? ""}|${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
