import type { ImageData } from "../../types/index.js";

export type LlmCallResult =
  | { success: true; data: string }
  | { success: false; reason: string; retryable: boolean };

export interface LlmProvider {
  readonly name: string;
  readonly supportsImages: boolean;
  readonly call: (
    prompt: string,
    images?: ImageData[],
  ) => Promise<LlmCallResult>;
}
