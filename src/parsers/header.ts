import { UTOL_ORIGIN } from "../config.js";
import type { Announcement, UpdateInfo } from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, load } from "./util.js";

/**
 * 時間割ページ左上のヘッダーアイコンのフィードを抽出する。
 * 両ドロップダウンの内容は時間割 HTML にインライン展開されている。
 *
 *  - 吹き出し（#ctrl_menu_info, alt「お知らせ」）: お知らせ一覧
 *      a.header-control-colomn[data1=contentId][data2=idnumber] > .info_title
 *  - ベル（#ctrl_menu_notification, alt「更新通知」）: 更新情報（最近の活動）
 *      a.header-control-colomn[href=/updateinfo/transition?...]（module/action/url を含む）
 */

/** 吹き出し＝お知らせ一覧。 */
export function parseHeaderAnnouncements(html: string): Announcement[] {
  const $ = load(html);
  const items: Announcement[] = [];
  $("#ctrl_menu_info a.header-control-colomn").each((_, el) => {
    const $a = $(el);
    // 「お知らせ一覧へ」等の遷移リンク（data1 が無い）は除外
    const contentId = $a.attr("data1");
    if (!contentId) return;
    const title = cleanText($a.find(".info_title").text() || $a.text());
    if (!title) return;
    items.push({
      title,
      postedAt: normalizeJstDateTime(cleanText($a.find("[class*='date']").text()) || matchDate($a.text())),
      courseIdnumber: $a.attr("data2") ?? null,
      contentId,
      url: null, // InfoDetail(contentId, idnumber) で開く（直接 URL なし）
    });
  });
  return items;
}

/** ベル＝更新情報（最近の活動）。 */
export function parseHeaderUpdates(html: string): UpdateInfo[] {
  const $ = load(html);
  const items: UpdateInfo[] = [];
  $("#ctrl_menu_notification a.header-control-colomn[href*='/updateinfo/transition']").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") ?? "";
    const text = cleanText($a.text());
    if (!text && !href) return;
    const q = (k: string) => {
      const m = href.match(new RegExp(`[?&]${k}=([^&]+)`));
      if (!m || !m[1]) return null;
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return m[1];
      }
    };
    const target = q("url");
    items.push({
      text,
      module: q("module"),
      action: q("action"),
      courseIdnumber: q("idnumber"),
      contentId: q("contentId"),
      at: normalizeJstDateTime(matchDate(text)),
      targetUrl: target ? absoluteUrl(target) : `${UTOL_ORIGIN}${href.replace(/&amp;/g, "&")}`,
    });
  });
  return items;
}

function matchDate(text: string): string | null {
  const m = text.match(/\d{4}[/\-年.]\d{1,2}[/\-月.]\d{1,2}(?:[日\s　]+\d{1,2}:\d{1,2})?/);
  return m ? m[0] : null;
}
