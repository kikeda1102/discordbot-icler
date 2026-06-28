import { logger } from "../utils/logger.js";

const EXPIRY_MS = 5 * 60 * 1000;

interface AwaitingEntry {
  fallbackTimerId: ReturnType<typeof setTimeout>;
  createdAt: number;
}

const awaitingEmbeds = new Map<string, AwaitingEntry>();

export const registerAwaiting = (
  messageId: string,
  fallbackTimerId: ReturnType<typeof setTimeout>,
): void => {
  if (awaitingEmbeds.has(messageId)) {
    return;
  }
  awaitingEmbeds.set(messageId, { fallbackTimerId, createdAt: Date.now() });
};

export const isAwaiting = (messageId: string): boolean =>
  awaitingEmbeds.has(messageId);

export const consumeAwaiting = (messageId: string): boolean => {
  const entry = awaitingEmbeds.get(messageId);
  if (entry === undefined) {
    return false;
  }
  clearTimeout(entry.fallbackTimerId);
  awaitingEmbeds.delete(messageId);
  return true;
};

export const removeAwaiting = (messageId: string): boolean =>
  awaitingEmbeds.delete(messageId);

export const cleanupAwaiting = (): void => {
  const now = Date.now();
  let removedCount = 0;

  for (const [messageId, entry] of awaitingEmbeds) {
    if (now - entry.createdAt > EXPIRY_MS) {
      clearTimeout(entry.fallbackTimerId);
      awaitingEmbeds.delete(messageId);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    logger.debug("embed 待ちエントリをクリーンアップしました", {
      removedCount,
      remainingCount: awaitingEmbeds.size,
    });
  }
};
