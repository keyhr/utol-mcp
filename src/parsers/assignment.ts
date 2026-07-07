import type { AssignmentDetail, Material } from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, extractIdnumber, load } from "./util.js";

/**
 * 課題詳細ページを抽出する（読み取りのみ）。
 * 提出フォームには触れない。締切・説明・添付・提出状況を拾う。
 */
export function parseAssignment(html: string, courseIdnumber?: string): AssignmentDetail {
  const $ = load(html);

  const title = cleanText($("h1, .report-title, .task-title, .title").first().text());
  const description =
    cleanText($(".description, .report-description, [class*='detail']").first().text()) || null;

  const dueRaw =
    cleanText($("[class*='deadline'], [class*='due']").first().text()) ||
    labeledValue($, ["締切", "提出期限", "受付終了"]);
  const openRaw = labeledValue($, ["受付開始", "公開"]);

  const attachments: Material[] = [];
  $("a[href*='setpreview'], a[href*='material'], a[href*='download']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    const t = cleanText($el.text());
    if (!t) return;
    attachments.push({
      title: t,
      resourceId: param($, href, "resourceId"),
      contentId: param($, href, "contentId"),
      fileId: param($, href, "fileId"),
      fileName: param($, href, "fileName"),
      objectName: null,
      openEndDate: null,
      downloadUrl: absoluteUrl(href),
      updatedAt: null,
    });
  });

  const submitted = inferSubmitted($.root().text());

  return {
    id: null,
    courseIdnumber: courseIdnumber ?? extractIdnumber($.html() ?? ""),
    courseName: null,
    title: title || "(無題の課題)",
    kind: /テスト|test/i.test(title) ? "test" : "assignment",
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

function labeledValue($: ReturnType<typeof load>, labels: string[]): string | null {
  let found: string | null = null;
  $("th, dt, .label").each((_, el) => {
    const key = cleanText($(el).text());
    if (labels.some((l) => key.includes(l))) {
      const val =
        cleanText($(el).next("td, dd").text()) || cleanText($(el).parent().find("td, dd").first().text());
      if (val) {
        found = val;
        return false;
      }
    }
    return undefined;
  });
  return found;
}

function param($: ReturnType<typeof load>, href: string, key: string): string | null {
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
