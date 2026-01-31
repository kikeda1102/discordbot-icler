import { describe, it, expect } from "vitest";
import { formatDateTimeJapanese } from "../src/utils/dateFormatter.js";

describe("formatDateTimeJapanese", () => {
  it("時刻付きで日本語形式にフォーマットする", () => {
    const date = new Date("2025-02-15T19:00:00+09:00");
    const result = formatDateTimeJapanese(date, false);

    expect(result).toContain("2025年");
    expect(result).toContain("2月");
    expect(result).toContain("15日");
    expect(result).toContain("19:00");
  });

  it("終日イベントの場合は時刻を省略する", () => {
    const date = new Date("2025-03-01T00:00:00+09:00");
    const result = formatDateTimeJapanese(date, true);

    expect(result).toContain("2025年");
    expect(result).toContain("3月");
    expect(result).toContain("1日");
    expect(result).not.toMatch(/\d{2}:\d{2}/);
  });

  it("曜日が含まれる", () => {
    const date = new Date("2025-02-15T19:00:00+09:00"); // 土曜日
    const result = formatDateTimeJapanese(date, false);

    expect(result).toContain("土");
  });
});
