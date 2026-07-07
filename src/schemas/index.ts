import { z } from "zod";

/**
 * UTOL の各画面から抽出した構造化データのスキーマ。
 * パーサはこれらの型を返し、MCP ツールはそのまま JSON として返す。
 *
 * 日時は JST 前提のため、パーサ側で ISO 8601 + オフセット（+09:00）へ正規化する。
 * ここでは検証を緩め（string）にして、正規化済みかどうかは normalizeDeadline に委ねる。
 */

/** 曜限（例: 月曜2限）。集中講義等は day/period が null になりうる。 */
export const DayPeriodSchema = z.object({
  day: z.string().nullable(), // "月".."日" / "その他"
  period: z.number().int().nullable(), // 1..N / null（時間割外）
  raw: z.string(), // 元表記
});
export type DayPeriod = z.infer<typeof DayPeriodSchema>;

/** 受講登録済みコース（時間割）1件。 */
export const CourseSummarySchema = z.object({
  idnumber: z.string(), // 例: 2025_0340_FEN-EE3902E1_01
  name: z.string(),
  teachers: z.array(z.string()).default([]),
  year: z.number().int().nullable(),
  term: z.string().nullable(), // S1/S2/A1/A2/通年 等
  dayPeriod: DayPeriodSchema.nullable(),
  url: z.string(),
});
export type CourseSummary = z.infer<typeof CourseSummarySchema>;

/** コース内の教材（資料）1件。 */
export const MaterialSchema = z.object({
  title: z.string(),
  resourceId: z.string().nullable(),
  contentId: z.string().nullable(), // dlMaterialId
  fileId: z.string().nullable(),
  fileName: z.string().nullable(),
  objectName: z.string().nullable(), // オブジェクトストレージ上のパス（DL に必要）
  openEndDate: z.string().nullable(), // 公開終了日時（DL パラメータ）
  downloadUrl: z.string().nullable(), // 直接 URL が判明する場合のみ
  updatedAt: z.string().nullable(), // ISO 8601 (+09:00)
});
export type Material = z.infer<typeof MaterialSchema>;

/** コース内／ヘッダーのお知らせ1件（本文は保存せずタイトル中心）。 */
export const AnnouncementSchema = z.object({
  title: z.string(),
  postedAt: z.string().nullable(), // ISO 8601 (+09:00)
  courseIdnumber: z.string().nullable().default(null),
  contentId: z.string().nullable().default(null),
  url: z.string().nullable(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** 更新情報（ベルアイコン＝最近の活動）1件。 */
export const UpdateInfoSchema = z.object({
  text: z.string(), // 表示テキスト（例: [月３計算製造学]・お知らせ(...)が追加されました。）
  module: z.string().nullable(), // information / report / test / material 等
  action: z.string().nullable(), // add / submit / answer 等
  courseIdnumber: z.string().nullable(),
  contentId: z.string().nullable(),
  at: z.string().nullable(), // ISO 8601 (+09:00)
  targetUrl: z.string().nullable(), // 遷移先（コース/課題/資料 等）
});
export type UpdateInfo = z.infer<typeof UpdateInfoSchema>;

/** 課題／テストの種別。 */
export const AssignmentKindSchema = z.enum(["assignment", "test", "questionnaire", "unknown"]);
export type AssignmentKind = z.infer<typeof AssignmentKindSchema>;

/** 課題一覧（/lms/task）や コース内課題の1件。 */
export const AssignmentSummarySchema = z.object({
  id: z.string().nullable(),
  courseIdnumber: z.string().nullable(),
  courseName: z.string().nullable(),
  title: z.string(),
  kind: AssignmentKindSchema.default("unknown"),
  dueAt: z.string().nullable(), // ISO 8601 (+09:00)
  submitted: z.boolean().nullable(), // 提出済みか（判明する場合）
  // 状態変更（提出不要トグル）用の識別子。/lms/task の状態リンクの data 属性由来。
  contentsType: z.string().nullable().default(null), // 1=課題/レポート など
  contentsId: z.string().nullable().default(null),
  noSubmission: z.boolean().nullable().default(null), // 現在「提出不要」か
  url: z.string().nullable(),
});
export type AssignmentSummary = z.infer<typeof AssignmentSummarySchema>;

/** 課題詳細（読み取りのみ）。 */
export const AssignmentDetailSchema = AssignmentSummarySchema.extend({
  description: z.string().nullable(),
  attachments: z.array(MaterialSchema).default([]),
  openAt: z.string().nullable(),
});
export type AssignmentDetail = z.infer<typeof AssignmentDetailSchema>;

/** コース詳細。 */
export const CourseDetailSchema = z.object({
  idnumber: z.string(),
  name: z.string(),
  teachers: z.array(z.string()).default([]),
  announcements: z.array(AnnouncementSchema).default([]),
  materials: z.array(MaterialSchema).default([]),
  assignments: z.array(AssignmentSummarySchema).default([]),
  syllabusUrl: z.string().nullable(),
  url: z.string(),
});
export type CourseDetail = z.infer<typeof CourseDetailSchema>;

/** シラバス（公開情報。受講登録外コースも取得可）。 */
export const SyllabusSchema = z.object({
  idnumber: z.string(),
  title: z.string(),
  teachers: z.array(z.string()).default([]),
  fields: z.record(z.string(), z.string()).default({}), // 見出し→本文 の汎用マップ
  url: z.string(),
});
export type Syllabus = z.infer<typeof SyllabusSchema>;

/**
 * コース検索結果1件（公開カタログ情報のみ・受講登録外コースを含む）。
 * 方針: 保護された内部コンテンツは含めない。
 */
export const SearchResultSchema = z.object({
  idnumber: z.string().nullable(),
  name: z.string(),
  teachers: z.array(z.string()).default([]),
  year: z.number().int().nullable(),
  term: z.string().nullable(),
  organization: z.string().nullable(),
  overview: z.string().nullable(),
  courseUrl: z.string().nullable(),
  syllabusUrl: z.string().nullable(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/** コース検索の入力パラメータ。 */
export const SearchQuerySchema = z.object({
  keyword: z.string().optional(),
  courseName: z.string().optional(),
  teacher: z.string().optional(),
  year: z.number().int().optional(),
  term: z.string().optional(),
  organization: z.string().optional(),
  day: z.string().optional(),
  period: z.number().int().optional(),
  limit: z.number().int().min(1).max(100).default(30),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** メッセージ（UTOL のメッセージ＝inquiry）1件。本文は保存せず一覧メタのみ。 */
export const MessageSchema = z.object({
  title: z.string(),
  participant: z.string().nullable(), // 参加者
  status: z.string().nullable(), // 未読/既読/回答済 等
  courseName: z.string().nullable(),
  createdAt: z.string().nullable(), // ISO 8601 (+09:00)
  updatedAt: z.string().nullable(),
  url: z.string().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

/** 認証状態。 */
export const AuthStatusSchema = z.object({
  authenticated: z.boolean(),
  checkedAt: z.string(), // ISO 8601 (+09:00)
  hint: z.string().nullable(),
});
export type AuthStatus = z.infer<typeof AuthStatusSchema>;
