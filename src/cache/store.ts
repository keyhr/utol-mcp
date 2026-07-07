import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cacheDir, cacheTtlMs } from "../config.js";
import { logger } from "../logger.js";

interface CacheEntry<T> {
  cachedAt: number;
  value: T;
}

/**
 * メタデータのローカルキャッシュ。
 * 方針doc準拠で「キャッシュ優先」により UTOL アクセスを抑える。
 *
 * 重要: 未ログイン応答や失敗結果はキャッシュしない（getOrFetch は fetcher の
 * 例外を伝播させ、結果のみを保存する）。教材本文・提出物等は保存しない。
 */
export class CacheStore {
  private file(key: string): string {
    const safe = createHash("sha1").update(key).digest("hex");
    return join(cacheDir(), `${safe}.json`);
  }

  async get<T>(key: string, ttlMs = cacheTtlMs()): Promise<T | null> {
    try {
      const raw = await readFile(this.file(key), "utf8");
      const entry = JSON.parse(raw) as CacheEntry<T>;
      if (Date.now() - entry.cachedAt <= ttlMs) {
        return entry.value;
      }
      return null;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
      const entry: CacheEntry<T> = { cachedAt: Date.now(), value };
      const path = this.file(key);
      await writeFile(path, JSON.stringify(entry), { mode: 0o600 });
      await chmod(path, 0o600).catch(() => {});
    } catch (err) {
      logger.warn("キャッシュ保存に失敗", { message: String(err) });
    }
  }

  /**
   * キャッシュ優先で取得する。fetcher が例外を投げた場合は保存せず伝播する
   * （未ログイン等をキャッシュ汚染させない）。
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    opts?: { ttlMs?: number; force?: boolean },
  ): Promise<T> {
    if (!opts?.force) {
      const cached = await this.get<T>(key, opts?.ttlMs);
      if (cached !== null) return cached;
    }
    const value = await fetcher();
    await this.set(key, value);
    return value;
  }
}
