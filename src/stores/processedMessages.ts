/**
 * 処理済みメッセージの管理
 * messageCreate と messageUpdate の重複処理を防止する
 */

import { logger } from '../utils/logger.js';

/** クリーンアップ対象とする経過時間（ミリ秒）: 10分 */
const EXPIRY_MS = 10 * 60 * 1000;

/** 処理済みメッセージ ID → 登録時刻 */
const processedMessages = new Map<string, number>();

/**
 * メッセージを処理済みとしてマークする
 */
export const markProcessed = (messageId: string): void => {
  processedMessages.set(messageId, Date.now());
};

/**
 * メッセージが処理済みかどうかを返す
 */
export const isProcessed = (messageId: string): boolean =>
  processedMessages.has(messageId);

/**
 * 古いエントリを削除する
 */
export const cleanupProcessedMessages = (): void => {
  const now = Date.now();
  let removedCount = 0;

  for (const [messageId, timestamp] of processedMessages) {
    if (now - timestamp > EXPIRY_MS) {
      processedMessages.delete(messageId);
      removedCount++;
    }
  }

  if (removedCount > 0) {
    logger.debug('処理済みメッセージをクリーンアップしました', {
      removedCount,
      remainingCount: processedMessages.size,
    });
  }
};
