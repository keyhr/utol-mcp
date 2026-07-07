import { describe, expect, it } from "vitest";
import { normalizeJstDateTime } from "../src/util/datetime.js";

describe("normalizeJstDateTime", () => {
  it("スラッシュ区切り＋時刻を +09:00 へ正規化する", () => {
    expect(normalizeJstDateTime("2026/01/31 23:59")).toBe("2026-01-31T23:59:00+09:00");
  });

  it("UTOL の '.0' 付きミリ秒表記を扱える", () => {
    expect(normalizeJstDateTime("2026-03-01 00:00:00.0")).toBe("2026-03-01T00:00:00+09:00");
  });

  it("和文表記を扱える", () => {
    expect(normalizeJstDateTime("2026年1月5日 9:5")).toBe("2026-01-05T09:05:00+09:00");
  });

  it("時刻なしは 00:00 とする", () => {
    expect(normalizeJstDateTime("2026/01/31")).toBe("2026-01-31T00:00:00+09:00");
  });

  it("UTOL の 24:00 表記を翌日 00:00 に正規化する", () => {
    expect(normalizeJstDateTime("2026/07/10 24:00")).toBe("2026-07-11T00:00:00+09:00");
    // 月末の 24:00 は翌月へ繰り上がる
    expect(normalizeJstDateTime("2026/01/31 24:00")).toBe("2026-02-01T00:00:00+09:00");
  });

  it("パース不能・空は null", () => {
    expect(normalizeJstDateTime("")).toBeNull();
    expect(normalizeJstDateTime("未定")).toBeNull();
    expect(normalizeJstDateTime(null)).toBeNull();
  });

  it("不正な月日は null", () => {
    expect(normalizeJstDateTime("2026/13/40")).toBeNull();
  });
});
