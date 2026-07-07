import { appendFile, chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./config.js";
import { nowJstIso } from "./util/datetime.js";
import { logger } from "./logger.js";

/**
 * 書き込み操作の監査ログ（方針doc: 書き込み操作には監査ログを備える）。
 * ローカルの ~/.utol-mcp/audit.log に追記する。個人情報は最小限（対象IDと操作）に留める。
 */
export async function auditWrite(entry: {
  action: string;
  target: Record<string, unknown>;
  result: "ok" | "error";
  detail?: string;
}): Promise<void> {
  try {
    await mkdir(dataDir(), { recursive: true, mode: 0o700 });
    const path = join(dataDir(), "audit.log");
    const line = JSON.stringify({ at: nowJstIso(), ...entry }) + "\n";
    await appendFile(path, line, { mode: 0o600 });
    await chmod(path, 0o600).catch(() => {});
  } catch (err) {
    logger.warn("監査ログの記録に失敗", { message: String(err) });
  }
}
