/**
 * ツール共通のエラー型。MCP ツール層でこれらを捕捉し、
 * 「次に何をすべきか」を含む応答へ変換する。
 */

/** 基底エラー。 */
export class UtolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * 未ログイン・セッション期限切れ。
 * 期限切れ時 UTOL は SSO ログインページを HTTP 200 で返すため、
 * client 層でこれを検出して投げる。自動ログインは行わない。
 */
export class NotAuthenticatedError extends UtolError {
  constructor(
    message = "UTOL にログインしていないか、セッションが期限切れです。",
  ) {
    super(message);
  }

  /** ユーザーへの次アクション案内。 */
  readonly hint =
    "ターミナルで `utol-mcp login` を実行し、ブラウザで手動ログインしてください。";
}

/**
 * HTML 構造が想定と異なりパースできない。
 * UTOL 側の画面改修の早期警報として利用する。
 */
export class ParseError extends UtolError {
  constructor(
    message: string,
    readonly context?: { page?: string; selector?: string },
  ) {
    super(message);
  }
}

/** レート制限・アクセス頻度に関するエラー。 */
export class RateLimitError extends UtolError {}

/**
 * 方針上アクセスを許可していない対象への要求（例: 受講登録外コースの内部コンテンツ）。
 */
export class AccessBoundaryError extends UtolError {
  constructor(
    message = "この操作は方針上許可されていません（受講登録外コースの保護された内部コンテンツ等）。",
  ) {
    super(message);
  }
}
