import { describe, it, expect } from "vitest";
import { formatEmbedsToTexts } from "../src/services/eventExtractor.js";
import type { EmbedLike } from "../src/types/index.js";

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
