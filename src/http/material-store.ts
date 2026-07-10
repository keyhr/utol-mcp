import { randomBytes } from "node:crypto";
import type { Material, MaterialSink } from "../tools/material-sink.js";
import { guessMimeType } from "../util/mime.js";
import { logger } from "../logger.js";

/** トークンの有効期間（ミリ秒）。 */
const TTL_MS = 5 * 60 * 1000;
/** インメモリ保持するファイルの上限サイズ（バイト）。 */
const MAX_BYTES = 200 * 1024 * 1024;

export interface Entry {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  expiresAt: number;
}

/**
 * ダウンロード用の一時ファイルをインメモリで保持する。
 * 高エントロピートークン＋短 TTL＋単回使用のケイパビリティ URL 方式。
 */
export class MaterialStore {
  private readonly entries = new Map<string, Entry>();

  /** バイト列を登録し、取り出し用トークンと有効期限を返す。 */
  put(material: Material): { token: string; expiresAt: number } {
    if (material.bytes > MAX_BYTES) {
      throw new Error(
        `ファイルが大きすぎます（${material.bytes} バイト > 上限 ${MAX_BYTES} バイト）。`,
      );
    }
    this.sweep();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + TTL_MS;
    this.entries.set(token, {
      buffer: material.buffer,
      fileName: material.fileName,
      mimeType: guessMimeType(material.fileName),
      expiresAt,
    });
    return { token, expiresAt };
  }

  /** トークンでバイト列を取り出す（単回使用＝取り出し後に削除）。期限切れ・不明は null。 */
  take(token: string): Entry | null {
    this.sweep();
    const entry = this.entries.get(token);
    if (!entry) return null;
    this.entries.delete(token);
    if (entry.expiresAt < Date.now()) return null;
    return entry;
  }

  /** 期限切れエントリを掃除する。 */
  private sweep(): void {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(token);
    }
  }
}

/**
 * HTTP 用。サーバーとクライアントが別マシンのため、ディスクへは書けない。
 * バイト列をストアへ預け、クライアントが curl で取得する一時 URL を返す。
 */
export class UrlFileSink implements MaterialSink {
  constructor(
    private readonly store: MaterialStore,
    private readonly baseUrl: URL,
  ) {}

  async deliver(material: Material): Promise<Record<string, unknown>> {
    const { token, expiresAt } = this.store.put(material);
    const url = new URL(`/dl/${token}`, this.baseUrl).href;
    logger.info("ダウンロード URL を発行しました", {
      fileName: material.fileName,
      bytes: material.bytes,
    });
    return {
      delivery: "url",
      url,
      fileName: material.fileName,
      bytes: material.bytes,
      expiresAt: new Date(expiresAt).toISOString(),
      hint: `curl -fL -o "${material.fileName}" "${url}" で保存できます（有効期限内・単回使用）。`,
    };
  }
}
