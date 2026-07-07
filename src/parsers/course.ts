import { UTOL_ORIGIN, UTOL_PATHS } from "../config.js";
import type {
  Announcement,
  AssignmentSummary,
  CourseDetail,
  Material,
} from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, extractIdnumber, load } from "./util.js";

/**
 * コース詳細ページ（/lms/course?idnumber=...、コーストップ）を抽出する。
 *
 * 実 HTML 構造（2026 時点で確認）:
 *   教材: #materialList 内 <div id="material<resourceId>" class="course-result-list materialCss">
 *         label.material-file-name（表示名）, span.fileName, span.resource_Id,
 *         span.openEndDate, input#dlMaterialId(value=contentId), .course-view-material-update（登録日）
 *   課題: #reportList 内 <div class="course-result-list sortReportBlock">
 *         a.course-view-report-name[href=.../report/submission?idnumber=..&reportId=..],
 *         .course-view-report-time-end（締切）, .course-view-report-status（提出状況）
 *   テスト: #examinationList 内 a.course-view-... (examinationId)
 */
export function parseCourse(html: string, idnumber: string): CourseDetail {
  const $ = load(html);

  const name =
    cleanText($("title").first().text()).replace(/\s*[|｜].*$/, "") ||
    cleanText($("h1.block-course-title-txt, .course-name, h1").first().text()) ||
    idnumber;

  const materials: Material[] = [];
  $("#materialList .course-result-list, .course-result-list.materialCss").each((_, el) => {
    const $row = $(el);
    const title = cleanText($row.find("label.material-file-name, .course-view-material-file-name label").first().text());
    if (!title) return;
    const resourceId =
      cleanText($row.find(".resource_Id").first().text()) ||
      (($row.attr("id") ?? "").match(/material(\d+)/)?.[1] ?? null);
    const contentId =
      $row.find('input[id="dlMaterialId"]').attr("value") ??
      $row.find("input[id^='dlMaterial']").attr("value") ??
      null;
    materials.push({
      title,
      resourceId: resourceId || null,
      contentId,
      fileId: null,
      fileName: cleanText($row.find(".fileName").first().text()) || null,
      objectName: cleanText($row.find(".objectName").first().text()) || null,
      openEndDate: cleanText($row.find(".openEndDate").first().text()) || null,
      downloadUrl: null, // 教材DLは2段階GET（make/tempfile → setfiledown）。download_material で実行。
      updatedAt: normalizeJstDateTime(
        cleanText($row.find(".course-view-material-update").first().text()),
      ),
    });
  });

  const assignments: AssignmentSummary[] = [];
  // レポート課題
  $("#reportList .course-result-list, .course-result-list.sortReportBlock").each((_, el) => {
    const $row = $(el);
    const $a = $row.find("a.course-view-report-name").first();
    const title = cleanText($a.text());
    if (!title) return;
    const href = $a.attr("href") ?? "";
    const reportId = href.match(/reportId=([^&]+)/)?.[1] ?? null;
    assignments.push({
      id: reportId,
      courseIdnumber: idnumber,
      courseName: name,
      title,
      kind: "assignment",
      dueAt: normalizeJstDateTime(
        cleanText($row.find(".course-view-report-time-end").first().text()),
      ),
      submitted: inferSubmitted(cleanText($row.find(".course-view-report-status").first().text())),
      contentsType: "1",
      contentsId: reportId,
      noSubmission: null,
      url: absoluteUrl(href),
    });
  });
  // テスト
  $("#examinationList .course-result-list").each((_, el) => {
    const $row = $(el);
    const $a = $row.find("a").filter((_, a) => /examination/.test($(a).attr("href") ?? "")).first();
    const title = cleanText($a.text() || $row.find("[class*='name']").first().text());
    if (!title) return;
    const href = $a.attr("href") ?? "";
    const examId = href.match(/examinationId=([^&]+)/)?.[1] ?? null;
    assignments.push({
      id: examId,
      courseIdnumber: idnumber,
      courseName: name,
      title,
      kind: "test",
      dueAt: normalizeJstDateTime(cleanText($row.find("[class*='time-end'], [class*='deadline']").first().text())),
      submitted: inferSubmitted(cleanText($row.find("[class*='status']").first().text())),
      contentsType: "2",
      contentsId: examId,
      noSubmission: null,
      url: absoluteUrl(href),
    });
  });

  const announcements: Announcement[] = [];
  $("#informationList .course-result-list, .course-view-information").each((_, el) => {
    const $row = $(el);
    const title = cleanText($row.find("a, [class*='name'], [class*='title']").first().text() || $row.text());
    if (!title) return;
    announcements.push({
      title,
      postedAt: normalizeJstDateTime(cleanText($row.find("[class*='date'], [class*='update']").first().text())),
      courseIdnumber: idnumber,
      contentId: null,
      url: absoluteUrl($row.find("a[href]").first().attr("href")),
    });
  });

  return {
    idnumber,
    name,
    teachers: [],
    announcements,
    materials,
    assignments,
    // シラバスは UTAS への外部リンク（#course_syllabus_link）。無ければ null。
    syllabusUrl: absoluteUrl($("#course_syllabus_link").attr("href")) ?? null,
    url: `${UTOL_ORIGIN}${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
  };
}

function inferSubmitted(text: string): boolean | null {
  if (!text) return null;
  if (/提出済|回答済|提出完了|受付完了/.test(text)) return true;
  if (/未提出|未回答/.test(text)) return false;
  return null;
}

/** 受講登録に必要なフォーム情報。登録可能なコースページにのみ存在する。 */
export interface EnrollForm {
  csrf: string;
  idnumber: string;
  rishunen: string;
  kougicd: string;
  kikancd: string;
}

/**
 * コースページ（#enrollParticipantForm）から受講登録フォームの値を抽出する。
 * 登録可能でない（既に受講登録済み／登録不可）場合は null。
 */
export function parseEnrollForm(html: string): EnrollForm | null {
  const $ = load(html);
  const $form = $("#enrollParticipantForm");
  if ($form.length === 0) return null;
  const v = (name: string) => $form.find(`input[name='${name}']`).attr("value") ?? "";
  const csrf = v("_csrf");
  const idnumber = v("idnumber");
  const rishunen = v("rishunen");
  const kougicd = v("kougicd");
  const kikancd = v("kikancd");
  if (!csrf || !idnumber) return null;
  return { csrf, idnumber, rishunen, kougicd, kikancd };
}

/** コースページから CSRF トークンを抽出する（登録解除等の POST 用）。 */
export function parseCourseCsrf(html: string): string | null {
  const $ = load(html);
  return $("input[name='_csrf']").first().attr("value") ?? null;
}
