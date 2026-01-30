/**
 * interactionCreate イベントハンドラ
 * ボタンクリック処理を担当
 */

import type { ButtonInteraction, Client, Interaction } from 'discord.js';
import { createCalendarEvent } from '../services/calendarService.js';
import {
  getPendingEvent,
  removePendingEvent,
  isEventExpired,
} from '../stores/pendingEvents.js';
import { logger } from '../utils/logger.js';

/** ボタンの customId プレフィックス */
const BUTTON_PREFIX = {
  REGISTER: 'event_register_',
  CANCEL: 'event_cancel_',
} as const;

/**
 * ボタンクリックを処理する
 * @param interaction ボタンインタラクション
 */
async function handleButtonClick(interaction: Interaction): Promise<void> {
  // ボタンインタラクション以外は無視
  if (!interaction.isButton()) {
    return;
  }

  const { customId } = interaction;

  // 登録ボタンの処理
  if (customId.startsWith(BUTTON_PREFIX.REGISTER)) {
    await handleRegisterButton(interaction, customId);
    return;
  }

  // キャンセルボタンの処理
  if (customId.startsWith(BUTTON_PREFIX.CANCEL)) {
    await handleCancelButton(interaction, customId);
    return;
  }
}

/**
 * 登録ボタンの処理
 */
async function handleRegisterButton(
  interaction: ButtonInteraction,
  customId: string
): Promise<void> {

  const eventId = customId.slice(BUTTON_PREFIX.REGISTER.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: '❌ このイベントは既に処理されたか、タイムアウトしました',
      ephemeral: true,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: '❌ このボタンは投稿者のみがクリックできます',
      ephemeral: true,
    });
    return;
  }

  // タイムアウトチェック
  if (isEventExpired(eventId)) {
    removePendingEvent(eventId);
    await interaction.update({
      content: '⏰ タイムアウトしました。もう一度投稿してください。',
      components: [],
    });
    return;
  }

  // カレンダーに登録
  const result = await createCalendarEvent(pending.eventInfo);

  if (result.success) {
    removePendingEvent(eventId);
    await interaction.update({
      content: `✅ カレンダーに登録しました\n\n**${pending.eventInfo.title}**`,
      components: [],
    });

    logger.info('カレンダー登録が承認されました', {
      eventId,
      title: pending.eventInfo.title,
      userId: interaction.user.id,
    });
  } else {
    await interaction.update({
      content: `❌ 登録に失敗しました: ${result.reason}`,
      components: [],
    });

    logger.error('カレンダー登録に失敗しました', {
      eventId,
      reason: result.reason,
    });
  }
}

/**
 * キャンセルボタンの処理
 */
async function handleCancelButton(
  interaction: ButtonInteraction,
  customId: string
): Promise<void> {

  const eventId = customId.slice(BUTTON_PREFIX.CANCEL.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: '❌ このイベントは既に処理されたか、タイムアウトしました',
      ephemeral: true,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: '❌ このボタンは投稿者のみがクリックできます',
      ephemeral: true,
    });
    return;
  }

  removePendingEvent(eventId);
  await interaction.update({
    content: '❌ キャンセルしました',
    components: [],
  });

  logger.info('カレンダー登録がキャンセルされました', {
    eventId,
    title: pending.eventInfo.title,
    userId: interaction.user.id,
  });
}

/**
 * interactionCreate イベントを登録する
 * @param client Discord Client
 */
export function registerInteractionHandler(client: Client): void {
  client.on('interactionCreate', (interaction) => {
    handleButtonClick(interaction).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error('インタラクション処理中にエラーが発生しました', {
          error: error.message,
        });
      }
    });
  });

  logger.info('interactionCreate ハンドラを登録しました');
}
