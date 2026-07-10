import type { ImageData } from "../../types/index.js";
import type { LlmCallResult, LlmProvider } from "./types.js";
import {
  DEFAULT_RETRY_CONFIG,
  isRetryableStatus,
  sleep,
  calculateBackoffDelay,
} from "./retry.js";
import { logger } from "../../utils/logger.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

const isGeminiResponse = (value: unknown): value is GeminiResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return true;
};

const callGeminiApiWithModel = async (
  model: string,
  apiKey: string,
  prompt: string,
  images?: ImageData[],
): Promise<LlmCallResult> => {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const parts: GeminiPart[] = [{ text: prompt }];

  if (images !== undefined && images.length > 0) {
    for (const image of images) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.base64Data,
        },
      });
    }
  }

  const requestBody = {
    contents: [
      {
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  for (let attempt = 0; attempt <= DEFAULT_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const retryable = isRetryableStatus(response.status);

        if (retryable && attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
          const delayMs = calculateBackoffDelay(attempt);
          logger.warn("Gemini API 一時エラー。リトライします", {
            model,
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
          reason: `Gemini API エラー: ${response.status} ${errorText}`,
        };
      }

      const json: unknown = await response.json();

      if (!isGeminiResponse(json)) {
        return {
          success: false,
          retryable: false,
          reason: "Gemini API レスポンスの形式が不正です",
        };
      }

      if (json.error !== undefined) {
        return {
          success: false,
          retryable: false,
          reason: `Gemini API エラー: ${json.error.message}`,
        };
      }

      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text === undefined) {
        return {
          success: false,
          retryable: false,
          reason: "Gemini API からテキストレスポンスがありません",
        };
      }

      if (attempt > 0) {
        logger.info("Gemini API リトライ成功", { model, attempt: attempt + 1 });
      }

      return {
        success: true,
        data: text,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "不明なエラー";

      if (attempt < DEFAULT_RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn("Gemini API 呼び出しエラー。リトライします", {
          model,
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
        reason: `Gemini API 呼び出しエラー: ${message}`,
      };
    }
  }

  return {
    success: false,
    retryable: false,
    reason: "Gemini API 呼び出しに失敗しました",
  };
};

export const createGeminiProvider = (apiKey: string): LlmProvider => ({
  name: "Gemini",
  supportsImages: true,
  call: async (prompt, images) => {
    const failures: string[] = [];

    for (const [index, model] of GEMINI_MODELS.entries()) {
      const result = await callGeminiApiWithModel(model, apiKey, prompt, images);

      if (result.success) {
        if (index > 0) {
          logger.info("フォールバックモデルで成功しました", { model });
        }
        return result;
      }

      failures.push(`${model}: ${result.reason}`);

      if (!result.retryable) {
        return result;
      }

      if (index < GEMINI_MODELS.length - 1) {
        logger.warn("フォールバックモデルへ切り替えます", {
          failedModel: model,
          nextModel: GEMINI_MODELS[index + 1],
        });
      }
    }

    return {
      success: false,
      retryable: true,
      reason: `Gemini 全モデルで失敗: ${failures.join(" / ")}`,
    };
  },
});
