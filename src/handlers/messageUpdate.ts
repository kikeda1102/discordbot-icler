/**
 * messageUpdate イベントハンドラ
 * embed が遅延生成された場合に、未処理のメッセージを再検出する
 */

import type { Client, Message, PartialMessage } from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import {
  isProcessed,
  markProcessed,
  unmarkProcessed,
} from '../stores/processedMessages.js';
import { consumeAwaiting } from '../stores/awaitingEmbeds.js';
import { logger } from '../utils/logger.js';
import { MESSAGE_UPDATE_MAX_AGE_MS } from '../config/constants.js';
import {
  processEventExtraction,
  shouldUnmarkProcessed,
  type ExtractionOutcome,
} from './messageCreate.js';

/**
 * messageUpdate ハンドラを生成する
 */
const createMessageUpdateHandler = (
  channelIds: string[],
  clientUserId: string,
) => {
  return async (
    oldMessage: Message | PartialMessage,
    newMessage: Message | PartialMessage,
  ): Promise<void> => {
    if (!channelIds.includes(newMessage.channelId)) {
      return;
    }

    // createdTimestamp は Snowflake ID から計算されるため partial でも利用可能
    const messageAgeMs = Date.now() - newMessage.createdTimestamp;
    if (messageAgeMs > MESSAGE_UPDATE_MAX_AGE_MS) {
      logger.debug('古いメッセージの更新を無視します', {
        messageId: newMessage.id,
        ageMs: messageAgeMs,
      });
      return;
    }

    // partial の場合は完全なメッセージを取得
    const message = newMessage.partial
      ? await newMessage.fetch()
      : newMessage;

    if (message.system) {
      return;
    }

    if (message.author.id === clientUserId) {
      return;
    }

    if (message.author.bot) {
      return;
    }

    // embed がなければスキップ（embed 追加以外の更新には興味がない）
    if (message.embeds.length === 0) {
      return;
    }

    // oldMessage が partial でない場合、embed が実際に追加されたかを確認する
    if (!oldMessage.partial && message.embeds.length <= oldMessage.embeds.length) {
      logger.debug('embed が追加されていないためスキップします', {
        messageId: message.id,
        oldEmbedCount: oldMessage.embeds.length,
        newEmbedCount: message.embeds.length,
      });
      return;
    }

    if (isProcessed(message.id)) {
      return;
    }

    const result = extractXUrls(message.content);
    if (!result.success) {
      return;
    }

    consumeAwaiting(message.id);
    markProcessed(message.id);

    logger.info('X/Twitter URL を検出しました', {
      urls: result.data,
      messageId: message.id,
      channelId: message.channelId,
      embedCount: message.embeds.length,
      source: 'messageUpdate',
    });

    const outcomes: ExtractionOutcome[] = [];
    for (const url of result.data) {
      outcomes.push(
        await processEventExtraction(message, message.content, message.embeds, url),
      );
    }

    // 回復経路である messageUpdate 自体が一時的失敗した場合も再処理可能な状態に戻す
    if (shouldUnmarkProcessed(outcomes)) {
      unmarkProcessed(message.id);
      logger.info('messageUpdate 処理で一時的エラーが発生したため処理済みマークを解除しました', {
        messageId: message.id,
      });
    }
  };
};

/**
 * messageUpdate イベントを登録する
 */
export const registerMessageUpdateHandler = (
  client: Client,
  channelIds: string[],
): void => {
  if (client.user === null) {
    logger.error('Client user が設定されていません');
    return;
  }

  const handler = createMessageUpdateHandler(channelIds, client.user.id);

  client.on('messageUpdate', (oldMessage, newMessage) => {
    handler(oldMessage, newMessage).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error('messageUpdate 処理中にエラーが発生しました', {
          error: error.message,
          messageId: newMessage.id,
        });
      }
    });
  });

  logger.debug('messageUpdate ハンドラを登録しました', { channelIds });
};
