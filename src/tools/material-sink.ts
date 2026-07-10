import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { downloadsDir } from "../config.js";

/** ダウンロードした教材バイト列。 */
export interface Material {
  buffer: Buffer;
  fileName: string;
  bytes: number;
}

/**
 * 教材ファイルを「クライアントの手元に届ける」戦略。
 * トランスポート差（stdio=同一マシンのディスク / HTTP=別マシン）を吸収する。
 * deliver の戻り値はそのままツールの JSON レスポンスになる。
 */
export interface MaterialSink {
  deliver(material: Material, opts: { destPath?: string }): Promise<Record<string, unknown>>;
}

/**
 * stdio 用。サーバー＝クライアント同一マシンなので、ディスクへ直接書く。
 * destPath 省略時は既定ダウンロードディレクトリへ fileName で保存する。
 */
export class LocalFileSink implements MaterialSink {
  async deliver(
    material: Material,
    opts: { destPath?: string },
  ): Promise<Record<string, unknown>> {
    const dest = await resolveDest(opts.destPath, material.fileName);
    await mkdir(dirOf(dest), { recursive: true });
    await writeFile(dest, material.buffer);
    return { delivery: "saved", saved: dest, fileName: material.fileName, bytes: material.bytes };
  }
}

async function resolveDest(destPath: string | undefined, fileName: string): Promise<string> {
  if (!destPath) {
    return join(downloadsDir(), fileName);
  }
  // ディレクトリらしき指定（末尾スラッシュ or 既存ディレクトリ）には fileName を付与する。
  if (destPath.endsWith("/")) {
    return join(destPath, fileName);
  }
  if (!isAbsolute(destPath)) {
    // 相対パスは既定ダウンロードディレクトリ基準で解決する。
    return join(downloadsDir(), destPath);
  }
  return destPath;
}

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf("/")) || "/";
}
