import * as cheerio from "cheerio";
import { UTOL_ORIGIN } from "../config.js";

export type CheerioRoot = cheerio.CheerioAPI;

export function load(html: string): CheerioRoot {
  return cheerio.load(html);
}

/** href/文字列から idnumber を抽出する。 */
export function extractIdnumber(value: string | undefined | null): string | null {
  if (!value) return null;
  const m = value.match(/idnumber=([^&"'\s]+)/);
  if (!m || !m[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** 相対 URL を UTOL の絶対 URL に整える。 */
export function absoluteUrl(href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("javascript:")) return null;
  if (trimmed.startsWith("http")) return trimmed;
  return `${UTOL_ORIGIN}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/** 空白を正規化したテキスト。 */
export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** 教員名の文字列を分割する（「, 」「／」「、」区切りを許容）。 */
export function splitTeachers(value: string | undefined | null): string[] {
  const text = cleanText(value);
  if (!text) return [];
  return text
    .split(/[,、／\/]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}
