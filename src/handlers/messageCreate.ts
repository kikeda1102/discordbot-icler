/**
 * messageCreate イベントハンドラ
 */

import type { Client, Message } from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import { extractTweetId, fetchTweet } from '../services/twitterClient.js';
import { extractEventInfo } from '../services/eventExtractor.js';
import { logger } from '../utils/logger.js';

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

    // 各 URL を処理
    for (const url of result.data) {
      await processTwitterUrl(url);
    }
  };
}

/**
 * X/Twitter URL を処理してイベント情報を抽出する
 * @param url X/Twitter URL
 */
async function processTwitterUrl(url: string): Promise<void> {
  // ツイートIDを抽出
  const tweetId = extractTweetId(url);
  if (tweetId === null) {
    logger.warn('ツイートIDを抽出できませんでした', { url });
    return;
  }

  // ツイートを取得
  const tweetResult = await fetchTweet(tweetId);
  if (!tweetResult.success) {
    logger.warn('ツイートの取得に失敗しました', {
      url,
      reason: tweetResult.reason,
    });
    return;
  }

  // イベント情報を抽出
  const eventResult = await extractEventInfo(tweetResult.data, url);
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
