/**
 * UTOL の日時表記はタイムゾーン情報を持たない JST 前提のため、
 * ISO 8601 + 固定オフセット +09:00 へ正規化する。
 *
 * 注意: JST は年間を通じて +09:00 固定（サマータイム無し）なので、
 * ライブラリなしで安全にオフセットを付与できる。
 */

const JST_OFFSET = "+09:00";

/**
 * UTOL 由来の日時文字列を ISO 8601 (+09:00) に正規化する。
 * パース不能な場合は null を返す（呼び出し側で許容）。
 *
 * 対応する主な表記:
 *  - "2026/01/31 23:59"
 *  - "2026-01-31 23:59:00.0"
 *  - "2026年1月31日 23:59"
 *  - "2026/01/31"（時刻なし → 00:00 扱い）
 */
export function normalizeJstDateTime(input: string | null | undefined): string | null {
  if (!input) return null;
  const text = input.trim();
  if (!text) return null;

  // 数字を抽出: 年 月 日 [時 分 [秒]]
  const m = text.match(
    /(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})(?:[日\s　]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (!m) return null;

  const [, y, mo, d, hh, mm, ss] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(hh ?? 0);
  const minute = Number(mm ?? 0);
  const second = Number(ss ?? 0);

  // 妥当性の軽い検証（UTOL は終端に 24:00 表記を用いるため hour<=24 を許容）
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 24 || minute > 59 || second > 59) return null;

  // Date.UTC で桁あふれ（24:00 → 翌日 00:00 など）を正規化する。
  // JST は +09:00 固定のため、壁時計値を UTC として解釈し、そのまま +09:00 を付与すれば JST の壁時計と一致する。
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    `${p(dt.getUTCFullYear(), 4)}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}` +
    `T${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}:${p(dt.getUTCSeconds())}${JST_OFFSET}`
  );
}

/** 現在時刻を ISO 8601 (+09:00) で返す。 */
export function nowJstIso(): string {
  // 現在の絶対時刻を JST 表記に変換
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}${JST_OFFSET}`;
}
