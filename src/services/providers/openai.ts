import type { ImageData } from "../../types/index.js";
import type { LlmCallResult, LlmProvider } from "./types.js";
import {
  DEFAULT_RETRY_CONFIG,
  FETCH_TIMEOUT_MS,
  isRetryableStatus,
  sleep,
  calculateBackoffDelay,
} from "./retry.js";
import { logger } from "../../utils/logger.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";

interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

const isOpenAIResponse = (value: unknown): value is OpenAIResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return true;
};

const callOpenAIApi = async (
  apiKey: string,
  prompt: string,
  images?: ImageData[],
): Promise<LlmCallResult> => {
  const userContent: OpenAIContentPart[] = [{ type: "text", text: prompt }];

  if (images !== undefined && images.length > 0) {
    for (const image of images) {
      userContent.push({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64Data}` },
      });
    }
  }

  const requestBody = {
    model: OPENAI_MODEL,
    messages: [{ role: "user", content: userContent }],
    temperature: 0.1,
    max_tokens: 1024,
  };

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = isRetryableStatus(response.status);

        if (retryable && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          logger.warn("OpenAI API 一時エラー。リトライします", {
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
          reason: `OpenAI API エラー: ${response.status} ${errorText}`,
        };
      }

      const json: unknown = await response.json();

      if (!isOpenAIResponse(json)) {
        return {
          success: false,
          retryable: false,
          reason: "OpenAI API レスポンスの形式が不正です",
        };
      }

      if (json.error !== undefined) {
        return {
          success: false,
          retryable: false,
          reason: `OpenAI API エラー: ${json.error.message}`,
        };
      }

      const text = json.choices?.[0]?.message?.content;
      if (text === undefined || text === null) {
        return {
          success: false,
          retryable: false,
          reason: "OpenAI API からテキストレスポンスがありません",
        };
      }

      if (attempt > 0) {
        logger.info("OpenAI API リトライ成功", { attempt: attempt + 1 });
      }

      return { success: true, data: text };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn("OpenAI API 呼び出しエラー。リトライします", {
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
        reason: `OpenAI API 呼び出しエラー: ${message}`,
      };
    }
  }

  return {
    success: false,
    retryable: false,
    reason: "OpenAI API 呼び出しに失敗しました",
  };
};

export const createOpenAIProvider = (apiKey: string): LlmProvider => ({
  name: "OpenAI",
  supportsImages: true,
  call: (prompt, images) => callOpenAIApi(apiKey, prompt, images),
});
