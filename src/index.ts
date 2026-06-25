/**
 * Discord Bot エントリーポイント
 */

import { getConfig } from './config/index.js';
import { createDiscordClient, registerConnectionLogger, startBot } from './client/index.js';
import { registerMessageHandler } from './handlers/messageCreate.js';
import { registerInteractionHandler } from './handlers/interactionCreate.js';
import { startCleanupTimer } from './stores/pendingEvents.js';
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

  // 接続監視ログを登録
  registerConnectionLogger(client);

  // イベントハンドラを登録
  registerMessageHandler(client, config.discord.channelIds);
  registerInteractionHandler(client);

  // 確認待ちイベントのクリーンアップタイマーを開始
  startCleanupTimer(client);

  logger.info('Discord Bot の起動が完了しました');
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    logger.error('予期しないエラーが発生しました', { error: error.message });
  }
  process.exit(1);
});
