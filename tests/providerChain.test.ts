import { describe, it, expect, vi } from "vitest";
import type { LlmProvider } from "../src/services/providers/types.js";
import { callLlmApi } from "../src/services/providers/providerChain.js";

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/services/providers/gemini.js", () => ({
  createGeminiProvider: vi.fn(),
}));

vi.mock("../src/services/providers/openai.js", () => ({
  createOpenAIProvider: vi.fn(),
}));

vi.mock("../src/services/providers/anthropic.js", () => ({
  createAnthropicProvider: vi.fn(),
}));

const createMockProvider = (
  name: string,
  result: Awaited<ReturnType<LlmProvider["call"]>>,
): LlmProvider => ({
  name,
  supportsImages: true,
  call: vi.fn().mockResolvedValue(result),
});

describe("callLlmApi プロバイダーチェイン", () => {
  it("最初のプロバイダーが成功したらそのまま返す", async () => {
    const provider1 = createMockProvider("Provider1", {
      success: true,
      data: "response text",
    });

    const result = await callLlmApi([provider1], "prompt");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("response text");
    }
    expect(provider1.call).toHaveBeenCalledTimes(1);
  });

  it("最初のプロバイダーが失敗したら次のプロバイダーにフォールバックする", async () => {
    const provider1 = createMockProvider("Provider1", {
      success: false,
      reason: "rate limited",
      retryable: true,
    });
    const provider2 = createMockProvider("Provider2", {
      success: true,
      data: "fallback response",
    });

    const result = await callLlmApi([provider1, provider2], "prompt");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("fallback response");
    }
    expect(provider1.call).toHaveBeenCalledTimes(1);
    expect(provider2.call).toHaveBeenCalledTimes(1);
  });

  it("非リトライエラーでも次のプロバイダーにフォールバックする", async () => {
    const provider1 = createMockProvider("Provider1", {
      success: false,
      reason: "bad request",
      retryable: false,
    });
    const provider2 = createMockProvider("Provider2", {
      success: true,
      data: "fallback response",
    });

    const result = await callLlmApi([provider1, provider2], "prompt");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("fallback response");
    }
  });

  it("全プロバイダーが失敗したら結合エラーメッセージを返す", async () => {
    const provider1 = createMockProvider("Gemini", {
      success: false,
      reason: "quota exceeded",
      retryable: true,
    });
    const provider2 = createMockProvider("OpenAI", {
      success: false,
      reason: "server error",
      retryable: true,
    });

    const result = await callLlmApi([provider1, provider2], "prompt");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toContain("Gemini");
      expect(result.reason).toContain("OpenAI");
    }
  });

  it("supportsImages が false のプロバイダーには images を渡さない", async () => {
    const provider = {
      name: "TextOnly",
      supportsImages: false,
      call: vi.fn().mockResolvedValue({ success: true, data: "ok" }),
    };

    const images = [{ mimeType: "image/png", base64Data: "abc123" }];
    await callLlmApi([provider], "prompt", images);

    expect(provider.call).toHaveBeenCalledWith("prompt", undefined);
  });

  it("supportsImages が true のプロバイダーには images をそのまま渡す", async () => {
    const provider = {
      name: "VisionCapable",
      supportsImages: true,
      call: vi.fn().mockResolvedValue({ success: true, data: "ok" }),
    };

    const images = [{ mimeType: "image/png", base64Data: "abc123" }];
    await callLlmApi([provider], "prompt", images);

    expect(provider.call).toHaveBeenCalledWith("prompt", images);
  });

  it("単一プロバイダーが成功したらフォールバックログを出さない", async () => {
    const { logger } = await import("../src/utils/logger.js");
    const infoMock = vi.mocked(logger.info);
    infoMock.mockClear();

    const provider = createMockProvider("Gemini", {
      success: true,
      data: "response",
    });

    await callLlmApi([provider], "prompt");

    expect(infoMock).not.toHaveBeenCalledWith(
      "フォールバックプロバイダーで成功しました",
      expect.anything(),
    );
  });
});
