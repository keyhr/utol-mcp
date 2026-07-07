import { UTOL_ORIGIN, UTOL_PATHS } from "../config.js";
import type { CourseSummary, DayPeriod } from "../schemas/index.js";
import { cleanText, load, splitTeachers } from "./util.js";

/**
 * 時間割ページ（/lms/timetable）から受講登録済みコース一覧を抽出する。
 *
 * 実 HTML 構造（2026 時点で確認）:
 *   <div class="timetable-course-top-btn ..." id="<idnumber>">
 *     <a class="bold-txt ...">コース名</a>
 *   </div>
 *   <div class="div-table-cell-detail"><span>教員名</span>,<span>...</span></div>
 * コース本体へは AJAX GET 遷移（id=idnumber を用いる）。href は javascript:void(0)。
 *
 * 曜日はセルの祖先 `N-yobicol`（1=月..6=土）から導出する。
 */
const YOBI_MAP: Record<string, string> = {
  "1": "月",
  "2": "火",
  "3": "水",
  "4": "木",
  "5": "金",
  "6": "土",
  "7": "日",
};

export function parseTimetable(html: string): CourseSummary[] {
  const $ = load(html);
  const byId = new Map<string, CourseSummary>();

  $(".timetable-course-top-btn[id]").each((_, el) => {
    const $el = $(el);
    const idnumber = ($el.attr("id") ?? "").trim();
    if (!isIdnumber(idnumber)) return;

    const name = cleanText($el.find("a").first().text()) || cleanText($el.text());
    if (!name) return;

    // 教員: 隣接する詳細セル内の span 群
    const $detail = $el.nextAll(".div-table-cell-detail").first();
    const teacherText = $detail
      .find("span")
      .map((_, s) => cleanText($(s).text()))
      .get()
      .join(",");
    const teachers = splitTeachers(teacherText);

    const dayPeriod = extractDayPeriod($, $el);

    if (byId.has(idnumber)) return;
    byId.set(idnumber, {
      idnumber,
      name,
      teachers,
      year: extractYearFromIdnumber(idnumber),
      term: null,
      dayPeriod,
      url: `${UTOL_ORIGIN}${UTOL_PATHS.course}?idnumber=${encodeURIComponent(idnumber)}`,
    });
  });

  return [...byId.values()];
}

/** idnumber 形式か（例: 2026_3747_3747-066_01）。 */
export function isIdnumber(value: string): boolean {
  return /^\d{4}_[\w.-]+_[\w.-]+$/.test(value);
}

/** idnumber 先頭の 4 桁を年度として解釈する。 */
export function extractYearFromIdnumber(idnumber: string): number | null {
  const m = idnumber.match(/^(\d{4})/);
  return m && m[1] ? Number(m[1]) : null;
}

/** セルの祖先 `N-yobicol` から曜日を導出する。時限は現状 raw のみ。 */
function extractDayPeriod(
  $: ReturnType<typeof load>,
  $el: ReturnType<ReturnType<typeof load>>,
): DayPeriod | null {
  const $col = $el.closest("[class*='-yobicol']");
  if ($col.length === 0) return null;
  const cls = $col.attr("class") ?? "";
  const m = cls.match(/(\d)-yobicol/);
  if (!m || !m[1]) return null;
  const day = YOBI_MAP[m[1]] ?? null;
  if (!day) return null;
  return { day, period: null, raw: `${day}` };
}
