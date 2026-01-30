/**
 * messageCreate イベントハンドラ
 */

import type { Client, Embed, Message } from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import { extractEventFromMessage } from '../services/eventExtractor.js';
import { createCalendarEvent } from '../services/calendarService.js';
import { logger } from '../utils/logger.js';

/** 指定ミリ秒待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * メッセージハンドラを作成する
 * @param channelIds 監視対象のチャンネルID配列
 * @param clientUserId Bot自身のユーザーID
 * @returns メッセージハンドラ関数
 */
function createMessageHandler(
  channelIds: string[],
  clientUserId: string
): (message: Message) => Promise<void> {
  return async (message: Message): Promise<void> => {
    // 指定チャンネル以外は無視
    if (!channelIds.includes(message.channelId)) {
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
    const embeds = await (async () => {
      if (message.embeds.length > 0) {
        return message.embeds;
      }
      logger.debug('embed がないため、3秒待機して再取得します');
      await sleep(3000);
      try {
        const refreshedMessage = await message.fetch();
        logger.debug('メッセージを再取得しました', {
          embedCount: refreshedMessage.embeds.length,
        });
        return refreshedMessage.embeds;
      } catch (error: unknown) {
        logger.warn('メッセージの再取得に失敗しました', {
          messageId: message.id,
        });
        return message.embeds;
      }
    })();

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
      await processEventExtraction(message, message.content, embeds, url);
    }
  };
}

/**
 * Discord メッセージからイベント情報を抽出し、Google Calendar に登録する
 * @param message Discord メッセージ（リアクション追加用）
 * @param content メッセージ本文
 * @param embeds 埋め込み情報
 * @param url X/Twitter URL
 */
async function processEventExtraction(
  message: Message,
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

  // Google Calendar に登録
  const calendarResult = await createCalendarEvent(eventResult.data);
  if (!calendarResult.success) {
    // 失敗時はサイレント（ログは calendarService で出力済み）
    return;
  }

  // 成功時: 📅リアクションを追加
  try {
    await message.react('📅');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.warn('リアクションの追加に失敗しました', { error: error.message });
    }
  }
}

/**
 * messageCreate イベントを登録する
 * @param client Discord Client
 * @param channelIds 監視対象のチャンネルID配列
 */
export function registerMessageHandler(
  client: Client,
  channelIds: string[]
): void {
  // client.user が null の場合は登録しない
  if (client.user === null) {
    logger.error('Client user が設定されていません');
    return;
  }

  const handler = createMessageHandler(channelIds, client.user.id);

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

  logger.info('messageCreate ハンドラを登録しました', { channelIds });
}
