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

    // ready イベントを待機
    return new Promise((resolve) => {
      client.once('ready', () => {
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
