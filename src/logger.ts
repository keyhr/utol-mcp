/**
 * stderr 限定ロガー。
 *
 * 重要: stdio トランスポートの MCP サーバーでは stdout は JSON-RPC 専用であり、
 * stdout に 1 バイトでも書くとプロトコルが壊れる。ログは必ず stderr に出す。
 *
 * また、方針docに従い Cookie・セッション・パスワード・個人情報をログに出さない。
 * 値の出力が必要な場合は呼び出し側で最小化・マスクする責務を負う。
 */

type Level = "debug" | "info" | "warn" | "error";

function enabled(level: Level): boolean {
  const configured = (process.env.UTOL_MCP_LOG_LEVEL ?? "info").toLowerCase();
  const order: Level[] = ["debug", "info", "warn", "error"];
  return order.indexOf(level) >= order.indexOf(configured as Level);
}

function emit(level: Level, message: string, meta?: Record<string, unknown>): void {
  if (!enabled(level)) return;
  const line =
    meta && Object.keys(meta).length > 0
      ? `[utol-mcp] ${level}: ${message} ${safeJson(meta)}`
      : `[utol-mcp] ${level}: ${message}`;
  process.stderr.write(line + "\n");
}

function safeJson(meta: Record<string, unknown>): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return "[unserializable meta]";
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};
