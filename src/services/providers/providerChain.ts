import type { Config, ImageData, Result } from "../../types/index.js";
import type { LlmProvider } from "./types.js";
import { createGeminiProvider } from "./gemini.js";
import { createOpenAIProvider } from "./openai.js";
import { createAnthropicProvider } from "./anthropic.js";
import { logger } from "../../utils/logger.js";

export const buildProviderChain = (config: Config): LlmProvider[] => {
  const chain: LlmProvider[] = [];

  chain.push(createGeminiProvider(config.gemini.apiKey));

  if (config.openai !== undefined) {
    chain.push(createOpenAIProvider(config.openai.apiKey));
  }
  if (config.anthropic !== undefined) {
    chain.push(createAnthropicProvider(config.anthropic.apiKey));
  }

  return chain;
};

export const callLlmApi = async (
  chain: readonly LlmProvider[],
  prompt: string,
  images?: ImageData[],
): Promise<Result<string>> => {
  const failures: string[] = [];

  for (const [index, provider] of chain.entries()) {
    const providerImages = provider.supportsImages ? images : undefined;

    const result = await provider.call(prompt, providerImages);

    if (result.success) {
      if (index > 0) {
        logger.info("フォールバックプロバイダーで成功しました", {
          provider: provider.name,
        });
      }
      return { success: true, data: result.data };
    }

    failures.push(`${provider.name}: ${result.reason}`);
    logger.warn("プロバイダーが失敗しました", {
      provider: provider.name,
      reason: result.reason,
      retryable: result.retryable,
    });
  }

  return {
    success: false,
    reason: `全プロバイダーで失敗: ${failures.join(" / ")}`,
  };
};
