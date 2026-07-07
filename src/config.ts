import { homedir } from "node:os";
import { join } from "node:path";

/**
 * UTOL のベース URL。ここ以外のホストへはアクセスしない。
 */
export const UTOL_ORIGIN = "https://utol.ecc.u-tokyo.ac.jp";

/**
 * 主要エンドポイント。パスは調査時点のもので、実装時の技術検証スパイクで確定・更新する。
 */
export const UTOL_PATHS = {
  login: "/login",
  samlLogin: "/saml/login?disco=true",
  timetable: "/lms/timetable",
  task: "/lms/task",
  course: "/lms/course",
  syllabus: "/lms/course/syllabus",
} as const;

/**
 * ローカルデータのルートディレクトリ。既定は ~/.utol-mcp。
 * セッション（browser-profile）とキャッシュ（cache）を含むため、
 * ディレクトリごと chmod 700 で作成する（config.ensureDataDir 参照）。
 * 環境変数 UTOL_MCP_HOME で上書き可能。
 */
export function dataDir(): string {
  return process.env.UTOL_MCP_HOME ?? join(homedir(), ".utol-mcp");
}

/** Playwright 永続コンテキストの userDataDir。 */
export function browserProfileDir(): string {
  return join(dataDir(), "browser-profile");
}

/** メタデータキャッシュのディレクトリ。 */
export function cacheDir(): string {
  return join(dataDir(), "cache");
}

/**
 * レート制限設定。方針doc準拠で、直列かつ最小間隔を設ける。
 * 環境変数で調整可能だが、下限を設けて過剰アクセスを防ぐ。
 */
export function minRequestIntervalMs(): number {
  const raw = Number(process.env.UTOL_MCP_MIN_INTERVAL_MS);
  const value = Number.isFinite(raw) ? raw : 1500;
  return Math.max(1000, value);
}

/** キャッシュの既定 TTL（ミリ秒）。既定 10 分。 */
export function cacheTtlMs(): number {
  const raw = Number(process.env.UTOL_MCP_CACHE_TTL_MS);
  const value = Number.isFinite(raw) ? raw : 10 * 60 * 1000;
  return Math.max(0, value);
}

/** auth_status の結果を短時間キャッシュする TTL（ミリ秒）。既定 60 秒。 */
export const AUTH_STATUS_TTL_MS = 60 * 1000;

/** UTOL の表示タイムゾーン。日時は JST 前提で正規化する。 */
export const UTOL_TIMEZONE = "Asia/Tokyo";

/** UTOL 側の URL を組み立てる。 */
export function utolUrl(path: string): string {
  return path.startsWith("http") ? path : `${UTOL_ORIGIN}${path}`;
}
