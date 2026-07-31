import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatEmbedsToTexts,
  parseEventJson,
  isValidParsedEventInfo,
  buildEventInfoFromParsed,
} from "../src/services/eventExtractor.js";
import type { EmbedLike, ParsedEventInfo } from "../src/types/index.js";

describe("formatEmbedsToTexts", () => {
  it("EmbedLike 形式の embed を正しくフォーマットする", () => {
    const embeds: EmbedLike[] = [
      {
        title: "テストタイトル",
        description: "テスト説明",
        author: { name: "テスト投稿者" },
        fields: [{ name: "フィールド1", value: "値1" }],
      },
    ];

    const result = formatEmbedsToTexts(embeds);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("投稿者: テスト投稿者");
    expect(result[0]).toContain("タイトル: テストタイトル");
    expect(result[0]).toContain("内容: テスト説明");
    expect(result[0]).toContain("フィールド1: 値1");
  });

  it("null 値のプロパティはスキップする", () => {
    const embeds: EmbedLike[] = [
      {
        title: null,
        description: "説明のみ",
        author: null,
        fields: [],
      },
    ];

    const result = formatEmbedsToTexts(embeds);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe("内容: 説明のみ");
    expect(result[0]).not.toContain("タイトル");
    expect(result[0]).not.toContain("投稿者");
  });

  it("空の embed はフィルタされる", () => {
    const embeds: EmbedLike[] = [
      {
        title: null,
        description: null,
        author: null,
        fields: [],
      },
    ];

    const result = formatEmbedsToTexts(embeds);

    expect(result).toHaveLength(0);
  });

  it("複数の embed を処理できる", () => {
    const embeds: EmbedLike[] = [
      {
        title: "イベント1",
        description: null,
        author: null,
        fields: [],
      },
      {
        title: "イベント2",
        description: null,
        author: null,
        fields: [],
      },
    ];

    const result = formatEmbedsToTexts(embeds);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe("タイトル: イベント1");
    expect(result[1]).toBe("タイトル: イベント2");
  });

  it("SerializedEmbed 形式と互換性がある", () => {
    // SerializedEmbed と同じ構造
    const serializedEmbed = {
      title: "シリアライズタイトル" as string | null,
      description: "シリアライズ説明" as string | null,
      url: "https://example.com" as string | null,
      author: { name: "シリアライズ投稿者" } as { name: string } | null,
      fields: [{ name: "フィールド", value: "値" }],
      image: { url: "https://example.com/img.png" } as { url: string } | null,
      thumbnail: null as { url: string } | null,
    };

    const result = formatEmbedsToTexts([serializedEmbed]);

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("投稿者: シリアライズ投稿者");
    expect(result[0]).toContain("タイトル: シリアライズタイトル");
  });
});

describe("isValidParsedEventInfo", () => {
  it("有効なオブジェクトの場合 true を返す", () => {
    const validObject: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "テストイベント",
      startTime: "2025-02-15T22:00:00+09:00",
      endTime: "2025-02-16T05:00:00+09:00",
      location: "渋谷",
      description: "テスト説明",
    };

    expect(isValidParsedEventInfo(validObject)).toBe(true);
  });

  it("null の場合 false を返す", () => {
    expect(isValidParsedEventInfo(null)).toBe(false);
  });

  it("undefined の場合 false を返す", () => {
    expect(isValidParsedEventInfo(undefined)).toBe(false);
  });

  it("空オブジェクトの場合 false を返す", () => {
    expect(isValidParsedEventInfo({})).toBe(false);
  });

  it("プロパティが不足している場合 false を返す", () => {
    const partialObject = {
      isEvent: true,
      hasTime: true,
      title: "テスト",
      // startTime, endTime, location, description が不足
    };

    expect(isValidParsedEventInfo(partialObject)).toBe(false);
  });

  it("型が違う場合 false を返す（isEvent が文字列）", () => {
    const wrongTypeObject = {
      isEvent: "yes", // boolean ではなく string
      hasTime: true,
      title: "テスト",
      startTime: "2025-02-15T22:00:00+09:00",
      endTime: "2025-02-16T05:00:00+09:00",
      location: "渋谷",
      description: "説明",
    };

    expect(isValidParsedEventInfo(wrongTypeObject)).toBe(false);
  });

  it("型が違う場合 false を返す（title が数値）", () => {
    const wrongTypeObject = {
      isEvent: true,
      hasTime: true,
      title: 123, // string ではなく number
      startTime: "2025-02-15T22:00:00+09:00",
      endTime: "2025-02-16T05:00:00+09:00",
      location: "渋谷",
      description: "説明",
    };

    expect(isValidParsedEventInfo(wrongTypeObject)).toBe(false);
  });
});

describe("parseEventJson", () => {
  it("有効な JSON をパースできる", () => {
    const jsonString = JSON.stringify({
      isEvent: true,
      hasTime: true,
      title: "テストイベント",
      startTime: "2025-02-15T22:00:00+09:00",
      endTime: "2025-02-16T05:00:00+09:00",
      location: "渋谷",
      description: "テスト説明",
    });

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("テストイベント");
      expect(result.data.isEvent).toBe(true);
    }
  });

  it("コードブロック付きの JSON をパースできる", () => {
    const jsonString = `\`\`\`json
{
  "isEvent": true,
  "hasTime": false,
  "title": "終日イベント",
  "startTime": "2025-03-01",
  "endTime": "2025-03-02",
  "location": "",
  "description": "終日のイベントです"
}
\`\`\``;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("終日イベント");
      expect(result.data.hasTime).toBe(false);
    }
  });

  it("不正な JSON でエラーを返す", () => {
    const jsonString = "{invalid json}";

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("JSONパースエラー");
    }
  });

  it("空文字列でエラーを返す", () => {
    const result = parseEventJson("");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("JSONパースエラー");
    }
  });

  it("型が不正な JSON でエラーを返す", () => {
    const jsonString = JSON.stringify({
      isEvent: "yes", // boolean ではなく string
      hasTime: true,
      title: "テスト",
      startTime: "2025-02-15",
      endTime: "2025-02-16",
      location: "",
      description: "",
    });

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("形式が不正");
    }
  });

  it("コードブロック（言語指定なし）の JSON をパースできる", () => {
    const jsonString = `\`\`\`
{
  "isEvent": true,
  "hasTime": true,
  "title": "言語指定なし",
  "startTime": "2025-04-01T18:00:00+09:00",
  "endTime": "2025-04-01T22:00:00+09:00",
  "location": "六本木",
  "description": "説明"
}
\`\`\``;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("言語指定なし");
    }
  });

  it("閉じの ``` がないコードブロック付きJSONをパースできる", () => {
    const jsonString = `\`\`\`json
{
  "isEvent": true,
  "hasTime": true,
  "title": "閉じタグなし",
  "startTime": "2025-05-01T20:00:00+09:00",
  "endTime": "2025-05-02T02:00:00+09:00",
  "location": "池袋",
  "description": "閉じタグがないケース"
}`;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("閉じタグなし");
    }
  });

  it("閉じの ``` がない言語指定なしコードブロック付きJSONをパースできる", () => {
    const jsonString = `\`\`\`
{
  "isEvent": true,
  "hasTime": false,
  "title": "言語指定なし閉じタグなし",
  "startTime": "2025-06-01",
  "endTime": "2025-06-02",
  "location": "",
  "description": ""
}`;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("言語指定なし閉じタグなし");
    }
  });

  it("不正なエスケープ文字を含むJSONをパースできる", () => {
    // Gemini APIが \* \. \+ \( \) \- などの正規表現エスケープを出力することがある
    const jsonString = `{
  "isEvent": true,
  "hasTime": true,
  "title": "お給仕RAVE",
  "startTime": "2026-02-21T16:00:00+09:00",
  "endTime": "2026-02-21T23:00:00+09:00",
  "location": "阿佐ヶ谷ドリフト",
  "description": "イベント\\*\\.\\+ﾟ開催\\(土\\)16:00\\-23:00"
}`;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("お給仕RAVE");
      expect(result.data.description).toBe("イベント*.+ﾟ開催(土)16:00-23:00");
    }
  });

  it("複数の不正なエスケープ文字を含むJSONをパースできる", () => {
    // 実際のGemini APIの出力例に近いパターン
    const jsonString = `{
  "isEvent": true,
  "hasTime": true,
  "title": "テストイベント",
  "startTime": "2026-03-15T20:00:00+09:00",
  "endTime": "2026-03-16T05:00:00+09:00",
  "location": "渋谷",
  "description": "【☁️主催告知☁️】\\n\\*\\.\\+ﾟお給仕RAVE\\*\\.\\+ﾟ\\n📅2/21\\(土\\)16:00\\-23:00"
}`;

    const result = parseEventJson(jsonString);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("テストイベント");
      // \n は有効なエスケープなので保持される
      expect(result.data.description).toContain("*.+ﾟお給仕RAVE*.+ﾟ");
      expect(result.data.description).toContain("(土)16:00-23:00");
    }
  });
});

describe("buildEventInfoFromParsed", () => {
  const testUrl = "https://x.com/test/status/123";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("有効なイベント情報から EventInfo を構築できる", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "テストイベント",
      startTime: "2025-02-15T22:00:00+09:00",
      endTime: "2025-02-16T05:00:00+09:00",
      location: "渋谷",
      description: "テスト説明",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe("テストイベント");
      expect(result.data.location).toBe("渋谷");
      expect(result.data.isAllDay).toBe(false);
      expect(result.data.url).toBe(testUrl);
    }
  });

  it("イベントでない場合は失敗を返す", () => {
    const parsed: ParsedEventInfo = {
      isEvent: false,
      hasTime: false,
      title: "",
      startTime: "",
      endTime: "",
      location: "",
      description: "",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("イベント情報が含まれていません");
    }
  });

  it("不正な日時の場合は失敗を返す", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "テスト",
      startTime: "invalid-date",
      endTime: "also-invalid",
      location: "",
      description: "",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("日時の形式が不正");
    }
  });

  it("終日イベント（hasTime: false）の場合 isAllDay が true になる", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: false,
      title: "終日イベント",
      startTime: "2025-03-01",
      endTime: "2025-03-02",
      location: "",
      description: "終日",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAllDay).toBe(true);
    }
  });

  it("時刻付きイベント（hasTime: true）の場合 isAllDay が false になる", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "時刻指定イベント",
      startTime: "2025-02-20T19:00:00+09:00",
      endTime: "2025-02-20T23:00:00+09:00",
      location: "新宿",
      description: "夜のイベント",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isAllDay).toBe(false);
    }
  });

  it("location がある場合は eventInfo.location に設定される", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "場所ありイベント",
      startTime: "2025-02-25T20:00:00+09:00",
      endTime: "2025-02-26T02:00:00+09:00",
      location: "東京",
      description: "説明",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBe("東京");
    }
  });

  it("location が空文字の場合は eventInfo.location が undefined になる", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "場所なしイベント",
      startTime: "2025-02-25T20:00:00+09:00",
      endTime: "2025-02-26T02:00:00+09:00",
      location: "",
      description: "説明",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location).toBeUndefined();
    }
  });

  it("開始日時が過去24時間以上前の場合は失敗を返す", () => {
    const parsed: ParsedEventInfo = {
      isEvent: true,
      hasTime: true,
      title: "過去のイベント",
      startTime: "2024-06-01T22:00:00+09:00",
      endTime: "2024-06-02T05:00:00+09:00",
      location: "渋谷",
      description: "半年前のイベント",
    };

    const result = buildEventInfoFromParsed(parsed, testUrl, "テスト");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("イベントの開始日時が過去のため無視します");
    }
  });
});
