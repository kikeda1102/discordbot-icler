import type { ImageData } from "../../types/index.js";
import type { LlmCallResult, LlmProvider } from "./types.js";
import {
  DEFAULT_RETRY_CONFIG,
  isRetryableStatus,
  sleep,
  calculateBackoffDelay,
} from "./retry.js";
import { logger } from "../../utils/logger.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_VERSION = "2023-06-01";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message: string;
  };
}

const isAnthropicResponse = (value: unknown): value is AnthropicResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return true;
};

const callAnthropicApi = async (
  apiKey: string,
  prompt: string,
  images?: ImageData[],
): Promise<LlmCallResult> => {
  const content: AnthropicContentBlock[] = [];

  if (images !== undefined && images.length > 0) {
    for (const image of images) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType,
          data: image.base64Data,
        },
      });
    }
  }

  content.push({ type: "text", text: prompt });

  const requestBody = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content }],
  };

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = isRetryableStatus(response.status);

        if (retryable && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          logger.warn("Anthropic API 一時エラー。リトライします", {
            status: response.status,
            attempt: attempt + 1,
            maxRetries: DEFAULT_RETRY_CONFIG.maxRetries + 1,
            delayMs,
          });
          await sleep(delayMs);
          continue;
        }

        return {
          success: false,
          retryable,
          reason: `Anthropic API エラー: ${response.status} ${errorText}`,
        };
      }

      const json: unknown = await response.json();

      if (!isAnthropicResponse(json)) {
        return {
          success: false,
          retryable: false,
          reason: "Anthropic API レスポンスの形式が不正です",
        };
      }

      if (json.error !== undefined) {
        return {
          success: false,
          retryable: false,
          reason: `Anthropic API エラー: ${json.error.message}`,
        };
      }

      const textBlock = json.content?.find((block) => block.type === "text");
      if (textBlock?.text === undefined) {
        return {
          success: false,
          retryable: false,
          reason: "Anthropic API からテキストレスポンスがありません",
        };
      }

      if (attempt > 0) {
        logger.info("Anthropic API リトライ成功", { attempt: attempt + 1 });
      }

      return { success: true, data: textBlock.text };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn("Anthropic API 呼び出しエラー。リトライします", {
          attempt: attempt + 1,
          maxRetries: DEFAULT_RETRY_CONFIG.maxRetries + 1,
          delayMs,
          error: message,
        });
        await sleep(delayMs);
        continue;
      }

      return {
        success: false,
        retryable: true,
        reason: `Anthropic API 呼び出しエラー: ${message}`,
      };
    }
  }

  return {
    success: false,
    retryable: false,
    reason: "Anthropic API 呼び出しに失敗しました",
  };
};

export const createAnthropicProvider = (apiKey: string): LlmProvider => ({
  name: "Anthropic",
  supportsImages: true,
  call: (prompt, images) => callAnthropicApi(apiKey, prompt, images),
});
