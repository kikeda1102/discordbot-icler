/**
 * Discord Bot エントリーポイント
 */

import { getConfig } from './config/index.js';
import { createDiscordClient, startBot } from './client/index.js';
import { registerMessageHandler } from './handlers/messageCreate.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Discord Bot を起動しています...');

  // 設定を読み込み
  const config = getConfig();

  // Discord Client を作成
  const client = createDiscordClient();

  // Bot を起動
  const result = await startBot(client, config.discord.botToken);

  if (!result.success) {
    logger.error('Bot の起動に失敗しました', { reason: result.reason });
    process.exit(1);
  }

  // イベントハンドラを登録
  registerMessageHandler(client, config.discord.channelIds);

  logger.info('Discord Bot の起動が完了しました');
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    logger.error('予期しないエラーが発生しました', { error: error.message });
  }
  process.exit(1);
});
