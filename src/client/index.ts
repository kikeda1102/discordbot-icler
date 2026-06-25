/**
 * Discord Client 初期化・管理
 */

import { Client, GatewayIntentBits } from 'discord.js';
import type { Result } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * Discord Client を作成する
 * 必要最小限の Intents を設定
 */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

/**
 * 接続状態の監視ログを登録する
 * Gateway の切断・再接続を記録し、問題の診断に役立てる
 */
export const registerConnectionLogger = (client: Client): void => {
  client.on('warn', (message) => {
    logger.warn('Discord クライアント警告', { message });
  });

  client.on('error', (error) => {
    logger.error('Discord クライアントエラー', { error: error.message });
  });

  client.on('shardDisconnect', (event, shardId) => {
    logger.warn('Discord Gateway から切断されました', {
      shardId,
      code: event.code,
      reason: event.reason,
    });
  });

  client.on('shardReconnecting', (shardId) => {
    logger.info('Discord Gateway に再接続しています', { shardId });
  });

  client.on('shardResume', (shardId, replayedEvents) => {
    logger.info('Discord Gateway に再接続しました', {
      shardId,
      replayedEvents,
    });
  });

  client.on('shardError', (error, shardId) => {
    logger.error('Discord Shard エラー', {
      shardId,
      error: error.message,
    });
  });

  client.on('invalidated', () => {
    logger.error('Discord セッションが無効化されました');
  });

  logger.info('接続監視ログを登録しました');
};

/**
 * Bot を起動する
 * @param client Discord Client インスタンス
 * @param token Bot トークン
 * @returns 起動結果
 */
export async function startBot(
  client: Client,
  token: string
): Promise<Result<void>> {
  try {
    await client.login(token);

    // clientReady イベントを待機（v15対応）
    return new Promise((resolve) => {
      client.once('clientReady', () => {
        if (client.user !== null) {
          logger.info('Discord Bot が起動しました', {
            username: client.user.username,
            id: client.user.id,
          });
        }
        resolve({ success: true, data: undefined });
      });
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Discord Bot の起動に失敗しました', {
        error: error.message,
      });
      return {
        success: false,
        reason: `Discord Bot の起動に失敗しました: ${error.message}`,
      };
    }
    return {
      success: false,
      reason: 'Discord Bot の起動に失敗しました: 不明なエラー',
    };
  }
}
