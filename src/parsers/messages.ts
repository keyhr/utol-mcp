import type { Message } from "../schemas/index.js";
import { normalizeJstDateTime } from "../util/datetime.js";
import { absoluteUrl, cleanText, load } from "./util.js";

/**
 * メッセージ一覧（/lms/inquiry_list）を抽出する。
 *
 * 実 HTML 構造（2026 時点で確認）: データ行 .course-result-list 内に
 *   .lms-inquiry-list-name（参加者）/.lms-inquiry-list-title（タイトル）/
 *   .lms-inquiry-list-status（ステータス）/.lms-inquiry-list-create-date（開始日）/
 *   .lms-inquiry-list-update-date（最終更新日）/.lms-inquiry-list-koginame（コース名）
 * ヘッダ行（.contents-header-txt / .bold-txt）は除外する。メッセージが無ければ空配列。
 */
export function parseMessages(html: string): Message[] {
  const $ = load(html);
  const messages: Message[] = [];

  $(".course-result-list").each((_, el) => {
    const $row = $(el);
    if ($row.hasClass("contents-header-txt")) return;
    const $title = $row.find(".lms-inquiry-list-title").first();
    const title = cleanText($title.text());
    if (!title) return; // ヘッダや空行を除外

    messages.push({
      title,
      participant: cleanText($row.find(".lms-inquiry-list-name").first().text()) || null,
      status: cleanText($row.find(".lms-inquiry-list-status").first().text()) || null,
      courseName: cleanText($row.find(".lms-inquiry-list-koginame").first().text()) || null,
      createdAt: normalizeJstDateTime(
        cleanText($row.find(".lms-inquiry-list-create-date").first().text()),
      ),
      updatedAt: normalizeJstDateTime(
        cleanText($row.find(".lms-inquiry-list-update-date").first().text()),
      ),
      url: absoluteUrl($row.find("a[href]").first().attr("href")),
    });
  });

  return messages;
}
