import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";

vi.mock("../src/config/index.js", () => ({
  getConfig: vi.fn(() => ({
    gemini: { apiKey: "test-api-key" },
  })),
}));

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { callGeminiApi } from "../src/services/eventExtractor.js";

const PRIMARY_MODEL = "gemini-2.5-flash-lite";
const FALLBACK_MODEL = "gemini-2.5-flash";

const successBody = JSON.stringify({
  candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
});

const httpResponse = (status: number, body: string): Response =>
  new Response(body, { status });

/** fetch が呼ばれた URL（n 番目）を取得する */
const fetchedUrl = (fetchMock: Mock, index: number): string => {
  const call = fetchMock.mock.calls[index];
  if (call === undefined || typeof call[0] !== "string") {
    throw new Error(`fetch call ${index} not found`);
  }
  return call[0];
};

/** バックオフ待機（fake timers）を進めながら callGeminiApi を完了させる */
const runCall = async (
  prompt: string,
): Promise<Awaited<ReturnType<typeof callGeminiApi>>> => {
  const resultPromise = callGeminiApi(prompt);
  await vi.runAllTimersAsync();
  return resultPromise;
};

describe("callGeminiApi のリトライとフォールバック", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("503 のあと成功したら同一モデルでリトライ成功する", async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(503, "overloaded"))
      .mockResolvedValueOnce(httpResponse(200, successBody));

    const result = await runCall("prompt");

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchedUrl(fetchMock, 0)).toContain(`${PRIMARY_MODEL}:`);
    expect(fetchedUrl(fetchMock, 1)).toContain(`${PRIMARY_MODEL}:`);
  });

  it("プライマリで 503 が続いたらフォールバックモデルに切り替える", async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(503, "overloaded"))
      .mockResolvedValueOnce(httpResponse(503, "overloaded"))
      .mockResolvedValueOnce(httpResponse(503, "overloaded"))
      .mockResolvedValueOnce(httpResponse(200, successBody));

    const result = await runCall("prompt");

    expect(result.success).toBe(true);
    // プライマリ 3 試行 + フォールバック 1 試行
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchedUrl(fetchMock, 2)).toContain(`${PRIMARY_MODEL}:`);
    expect(fetchedUrl(fetchMock, 3)).toContain(`/${FALLBACK_MODEL}:`);
  });

  it("400 はリトライもフォールバックもせず即失敗する", async () => {
    fetchMock.mockResolvedValueOnce(httpResponse(400, "bad request"));

    const result = await runCall("prompt");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("400");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 はリトライされる（リグレッションガード）", async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(429, "rate limited"))
      .mockResolvedValueOnce(httpResponse(200, successBody));

    const result = await runCall("prompt");

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 502, 504])("%d も一時エラーとしてリトライされる", async (status) => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(status, "server error"))
      .mockResolvedValueOnce(httpResponse(200, successBody));

    const result = await runCall("prompt");

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ネットワークエラーもリトライ後にフォールバックへ進む", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(httpResponse(200, successBody));

    const result = await runCall("prompt");

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchedUrl(fetchMock, 3)).toContain(`/${FALLBACK_MODEL}:`);
  });

  it("全モデル全試行が 503 なら fetch 6 回で失敗し、両モデル名が reason に入る", async () => {
    // Response の body は一度しか読めないため、呼び出しごとに新しいインスタンスを返す
    fetchMock.mockImplementation(() =>
      Promise.resolve(httpResponse(503, "overloaded")),
    );

    const result = await runCall("prompt");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain(PRIMARY_MODEL);
      expect(result.reason).toContain(FALLBACK_MODEL);
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
