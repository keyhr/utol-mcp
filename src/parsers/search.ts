import { UTOL_ORIGIN, UTOL_PATHS } from "../config.js";
import type { SearchResult } from "../schemas/index.js";
import { extractYearFromIdnumber } from "./timetable.js";
import { absoluteUrl, cleanText, load, splitTeachers } from "./util.js";

/**
 * コース検索結果ページ（/course/search）を抽出する。
 * 公開カタログ情報のみ（受講登録外コースを含む）。保護された内部コンテンツは含めない。
 *
 * 実 HTML 構造（2026 時点で確認）: <tr class="course-search-result-list"> 内に
 *   td.course-search-course-name > a.linkToCoursetop[id=idnumber]（コース名）
 *   td.course-search-teacher-name span（教員, カンマ区切り）
 *   td.course-search-nendo（年度）
 *   td.course-search-section（開講期 S/A 等）
 *   td.course-search-day-of-week（曜日時限）
 *   td.course-search-category（開講組織）
 *   td.course-search-syllabus > a[href=UTASシラバス]
 */
export function parseSearchResults(html: string): SearchResult[] {
  const $ = load(html);
  const results: SearchResult[] = [];

  $("tr.course-search-result-list").each((_, el) => {
    const $row = $(el);
    const $courseLink = $row.find(".course-search-course-name a.linkToCoursetop").first();
    const name = cleanText($courseLink.text()) || cleanText($row.find(".course-search-course-name").text());
    if (!name) return;
    const idnumber = ($courseLink.attr("id") ?? "").trim() || null;

    const syllabusUrl = absoluteUrl(
      $row.find(".course-search-syllabus a").first().attr("href"),
    );

    const nendoText = cleanText($row.find(".course-search-nendo").text());
    const year = nendoText && /^\d{4}$/.test(nendoText)
      ? Number(nendoText)
      : idnumber
        ? extractYearFromIdnumber(idnumber)
        : null;

    const dayOfWeek = cleanText($row.find(".course-search-day-of-week").text()) || null;

    results.push({
      idnumber,
      name,
      teachers: splitTeachers($row.find(".course-search-teacher-name").text()),
      year,
      term: cleanText($row.find(".course-search-section").text()) || null,
      organization: cleanText($row.find(".course-search-category").text()) || null,
      // 概要は検索結果に含まれない。曜日時限は overview に補助表示する。
      overview: dayOfWeek,
      courseUrl: idnumber
        ? `${UTOL_ORIGIN}${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`
        : null,
      syllabusUrl,
    });
  });

  return results;
}
