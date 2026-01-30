/**
 * messageCreate イベントハンドラ
 */

import type { Client, Embed, Message } from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import { extractEventFromMessage } from '../services/eventExtractor.js';
import { logger } from '../utils/logger.js';

/** 指定ミリ秒待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * メッセージハンドラを作成する
 * @param channelId 監視対象のチャンネルID
 * @param clientUserId Bot自身のユーザーID
 * @returns メッセージハンドラ関数
 */
function createMessageHandler(
  channelId: string,
  clientUserId: string
): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    // 指定チャンネル以外は無視
    if (message.channelId !== channelId) {
      return;
    }

    // システムメッセージは無視
    if (message.system) {
      return;
    }

    // Bot自身のメッセージは無視
    if (message.author.id === clientUserId) {
      return;
    }

    // Botからのメッセージは無視
    if (message.author.bot) {
      return;
    }

    // X/Twitter URL を抽出
    const result = extractXUrls(message.content);

    if (!result.success) {
      // URLが見つからない場合は何もしない
      return;
    }

    // URL が見つかった場合はログ出力
    logger.info('X/Twitter URL を検出しました', {
      urls: result.data,
      messageId: message.id,
      authorId: message.author.id,
      channelId: message.channelId,
    });

    // embed が遅延読み込みされるため、少し待ってからメッセージを再取得
    let embeds = message.embeds;
    if (embeds.length === 0) {
      logger.debug('embed がないため、3秒待機して再取得します');
      await sleep(3000);
      try {
        const refreshedMessage = await message.fetch();
        embeds = refreshedMessage.embeds;
        logger.debug('メッセージを再取得しました', {
          embedCount: embeds.length,
        });
      } catch (error: unknown) {
        logger.warn('メッセージの再取得に失敗しました', {
          messageId: message.id,
        });
      }
    }

    // メッセージ本文と embed 情報をログ出力（デバッグ用）
    logger.debug('メッセージ内容', {
      content: message.content,
      embedCount: embeds.length,
      embeds: embeds.map((embed) => ({
        title: embed.title,
        description: embed.description,
        url: embed.url,
        author: embed.author,
        fields: embed.fields,
      })),
    });

    // 各 URL を処理
    for (const url of result.data) {
      await processEventExtraction(message.content, embeds, url);
    }
  };
}

/**
 * Discord メッセージからイベント情報を抽出する
 * @param content メッセージ本文
 * @param embeds 埋め込み情報
 * @param url X/Twitter URL
 */
async function processEventExtraction(
  content: string,
  embeds: Embed[],
  url: string
): Promise<void> {
  // イベント情報を抽出
  const eventResult = await extractEventFromMessage(content, embeds, url);
  if (!eventResult.success) {
    logger.warn('イベント情報の抽出に失敗しました', {
      url,
      reason: eventResult.reason,
    });
    return;
  }

  logger.info('イベント情報を抽出しました', {
    url,
    event: {
      title: eventResult.data.title,
      startTime: eventResult.data.startTime.toISOString(),
      endTime: eventResult.data.endTime.toISOString(),
      location: eventResult.data.location,
    },
  });

  // TODO: Step 3b で Google Calendar に登録
}

/**
 * messageCreate イベントを登録する
 * @param client Discord Client
 * @param channelId 監視対象のチャンネルID
 */
export function registerMessageHandler(
  client: Client,
  channelId: string
): void {
  // client.user が null の場合は登録しない
  if (client.user === null) {
    logger.error('Client user が設定されていません');
    return;
  }

  const handler = createMessageHandler(channelId, client.user.id);

  client.on('messageCreate', (message) => {
    handler(message).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error('メッセージ処理中にエラーが発生しました', {
          error: error.message,
          messageId: message.id,
        });
      }
    });
  });

  logger.info('messageCreate ハンドラを登録しました', { channelId });
}
