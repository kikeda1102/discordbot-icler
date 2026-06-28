/**
 * messageUpdate イベントハンドラ
 * embed が遅延生成された場合に、未処理のメッセージを再検出する
 */

import type { Client, Message, PartialMessage } from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import { isProcessed, markProcessed } from '../stores/processedMessages.js';
import { consumeAwaiting } from '../stores/awaitingEmbeds.js';
import { logger } from '../utils/logger.js';
import { processEventExtraction } from './messageCreate.js';

/**
 * messageUpdate ハンドラを生成する
 */
const createMessageUpdateHandler = (
  channelIds: string[],
  clientUserId: string,
) => {
  return async (
    _oldMessage: Message | PartialMessage,
    newMessage: Message | PartialMessage,
  ): Promise<void> => {
    if (!channelIds.includes(newMessage.channelId)) {
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

    if (isProcessed(message.id)) {
      return;
    }

    const result = extractXUrls(message.content);
    if (!result.success) {
      return;
    }

    consumeAwaiting(message.id);
    markProcessed(message.id);

    logger.info('messageUpdate で X/Twitter URL を検出しました', {
      urls: result.data,
      messageId: message.id,
      authorId: message.author.id,
      channelId: message.channelId,
      embedCount: message.embeds.length,
    });

    for (const url of result.data) {
      await processEventExtraction(message, message.content, message.embeds, url);
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

  logger.info('messageUpdate ハンドラを登録しました', { channelIds });
};
