import type { Syllabus } from "../schemas/index.js";
import { cleanText, load } from "./util.js";

/**
 * UTAS のシラバス参照ページ（_flowId=SYW0001000-flow）を抽出する。
 * 公開情報のため受講登録外コースも取得対象。
 *
 * 実 HTML 構造（2026 時点で確認）: 複数の table 内 th/td ペアで構成される。
 * 見出し（th）→本文（td）の汎用マップとして拾い、タイトル・教員は主要フィールドから導出する。
 */
export function parseSyllabus(html: string, idnumber: string, url: string): Syllabus {
  const $ = load(html);

  const fields: Record<string, string> = {};
  $("table tr").each((_, tr) => {
    const $tr = $(tr);
    const key = cleanText($tr.find("th").first().text());
    const val = cleanText($tr.find("td").first().text());
    if (key && val && !(key in fields)) fields[key] = val;
  });
  // 定義リスト（dt/dd）も補助的に取り込む
  $("dl dt").each((_, dt) => {
    const key = cleanText($(dt).text());
    const val = cleanText($(dt).next("dd").text());
    if (key && val && !(key in fields)) fields[key] = val;
  });

  const title =
    pick(fields, [/開講科目名|科目名|Course Title/]) ||
    cleanText($("title").first().text()) ||
    idnumber;
  const teacherStr = pick(fields, [/主担当教員|担当教員|Instructor/]) ?? "";
  const teachers = teacherStr
    .split(/[、,／\/]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return { idnumber, title, teachers, fields, url };
}

function pick(fields: Record<string, string>, patterns: RegExp[]): string | null {
  for (const [k, v] of Object.entries(fields)) {
    if (patterns.some((p) => p.test(k))) return v;
  }
  return null;
}
