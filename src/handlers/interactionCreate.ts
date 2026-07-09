/**
 * interactionCreate イベントハンドラ
 * ボタンクリック処理を担当
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  createCalendarEvent,
  updateCalendarEvent,
  findSimilarEvents,
} from "../services/calendarService.js";
import { PENDING_EVENT_TIMEOUT_MINUTES } from "../config/constants.js";
import type { EventInfo, PendingEvent, SimilarEvent } from "../types/index.js";
import {
  getPendingEvent,
  removePendingEvent,
  isEventExpired,
  updatePendingEvent,
} from "../stores/pendingEvents.js";
import { unmarkProcessed } from "../stores/processedMessages.js";
import { logger } from "../utils/logger.js";
import { formatDateTimeJapanese } from "../utils/dateFormatter.js";
import { buildSurveySuffix } from "../utils/survey.js";

/** ボタンの customId プレフィックス */
const BUTTON_PREFIX = {
  REGISTER: "event_register_",
  CANCEL: "event_cancel_",
  FORCE_REGISTER: "event_force_register_",
  FORCE_CANCEL: "event_force_cancel_",
  OVERWRITE: "event_overwrite_",
  HELP: "event_help",
} as const;

/** セレクトメニューの customId プレフィックス */
const SELECT_PREFIX = {
  OVERWRITE_TARGET: "event_ow_select_",
} as const;

const CALENDAR_URL = "https://icler-calendar.vercel.app/";

/**
 * イベント情報を完了メッセージ用にフォーマットする
 */
function formatEventInfoForMessage(eventInfo: EventInfo): string {
  const isAllDay = eventInfo.isAllDay === true;
  const lines: string[] = [`**${eventInfo.title}**`];

  // 日時
  const dateStr = formatDateTimeJapanese(eventInfo.startTime, isAllDay);
  lines.push(isAllDay ? `📅 ${dateStr}（終日）` : `📅 ${dateStr}`);

  // 場所
  if (eventInfo.location !== undefined && eventInfo.location !== "") {
    lines.push(`📍 ${eventInfo.location}`);
  }

  return lines.join("\n");
}

/** 使い方の説明テキスト */
const HELP_TEXT = `📖 **使い方**

**ボタン操作:**
• 「登録する」→ Google カレンダーにイベントを登録
• 「キャンセル」→ 登録せずにキャンセル

**修正方法:**
この確認メッセージに**返信**すると、修正指示として処理されます。
例: 「時間は22:00からです」「場所はClub XYZです」

**注意:**
• ボタン操作と修正は**投稿者のみ**が行えます
• **${PENDING_EVENT_TIMEOUT_MINUTES}分**経過するとタイムアウトします`;

/**
 * インタラクションを処理する
 */
async function handleButtonClick(interaction: Interaction): Promise<void> {
  if (interaction.isButton()) {
    const { customId } = interaction;

    if (customId.startsWith(BUTTON_PREFIX.REGISTER)) {
      await handleRegisterButton(interaction, customId);
      return;
    }

    if (customId.startsWith(BUTTON_PREFIX.CANCEL)) {
      await handleCancelButton(interaction, customId);
      return;
    }

    if (customId.startsWith(BUTTON_PREFIX.OVERWRITE)) {
      await handleOverwriteButton(interaction, customId);
      return;
    }

    if (customId.startsWith(BUTTON_PREFIX.FORCE_REGISTER)) {
      await handleForceRegisterButton(interaction, customId);
      return;
    }

    if (customId.startsWith(BUTTON_PREFIX.FORCE_CANCEL)) {
      await handleForceCancelButton(interaction, customId);
      return;
    }

    if (customId === BUTTON_PREFIX.HELP) {
      await handleHelpButton(interaction);
      return;
    }
  }

  if (interaction.isStringSelectMenu()) {
    const { customId } = interaction;

    if (customId.startsWith(SELECT_PREFIX.OVERWRITE_TARGET)) {
      await handleOverwriteSelect(interaction, customId);
      return;
    }
  }
}

/**
 * ヘルプボタンの処理
 */
async function handleHelpButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.reply({
    content: HELP_TEXT,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * 類似イベントの警告メッセージを生成
 */
function formatSimilarEventsWarning(similarEvents: SimilarEvent[]): string {
  const eventLines = similarEvents.map((event) => {
    const locationText =
      event.location !== undefined ? `\n  場所: ${event.location}` : "";
    return `• **${event.title}** (${event.startTime})${locationText}`;
  });

  return `⚠️ 以下の類似イベントが既に登録されています:\n\n${eventLines.join("\n\n")}\n\nそれでも登録しますか？`;
}

/**
 * 登録ボタンの処理
 */
async function handleRegisterButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(BUTTON_PREFIX.REGISTER.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ このボタンは投稿者のみがクリックできます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // タイムアウトチェック
  if (isEventExpired(eventId)) {
    removePendingEvent(eventId);
    // まず Ephemeral メッセージで通知（インタラクションを応答）
    await interaction.reply({
      content: "⏰ タイムアウトしました。もう一度投稿してください。",
      flags: MessageFlags.Ephemeral,
    });
    // その後に確認メッセージを削除
    await deleteConfirmationMessage(interaction);
    return;
  }

  // 類似イベントをチェック
  await interaction.deferUpdate();

  const similarResult = await findSimilarEvents(pending.eventInfo);

  if (!similarResult.success) {
    logger.warn("類似イベント検索に失敗しましたが、登録を続行します", {
      reason: similarResult.reason,
    });
    // 検索に失敗した場合は警告なしで登録を続行
    await registerEventToCalendar(interaction, eventId, pending);
    return;
  }

  // 類似イベントがある場合は警告を表示
  if (similarResult.data.length > 0) {
    const warningMessage = formatSimilarEventsWarning(similarResult.data);

    updatePendingEvent(eventId, { similarEvents: similarResult.data });

    const firstSimilarEvent = similarResult.data[0];

    if (similarResult.data.length === 1 && firstSimilarEvent !== undefined) {
      updatePendingEvent(eventId, {
        overwriteTargetCalendarEventId: firstSimilarEvent.id,
      });

      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.OVERWRITE}${eventId}`)
          .setLabel("上書き更新")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.FORCE_REGISTER}${eventId}`)
          .setLabel("新規登録")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.FORCE_CANCEL}${eventId}`)
          .setLabel("キャンセル")
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        content: warningMessage,
        components: [buttonRow],
      });
    } else {
      const selectRow =
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${SELECT_PREFIX.OVERWRITE_TARGET}${eventId}`)
            .setPlaceholder("上書きするイベントを選択...")
            .addOptions(
              similarResult.data.map((evt) => ({
                label: evt.title.slice(0, 100),
                description: evt.startTime,
                value: evt.id,
              })),
            ),
        );

      const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.FORCE_REGISTER}${eventId}`)
          .setLabel("新規登録")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`${BUTTON_PREFIX.FORCE_CANCEL}${eventId}`)
          .setLabel("キャンセル")
          .setStyle(ButtonStyle.Secondary),
      );

      await interaction.editReply({
        content: warningMessage,
        components: [selectRow, buttonRow],
      });
    }

    logger.info("類似イベントの警告を表示しました", {
      eventId,
      similarCount: similarResult.data.length,
    });
    return;
  }

  // 類似イベントがない場合は通常通り登録
  await registerEventToCalendar(interaction, eventId, pending);
}

/**
 * 確認メッセージを削除する
 */
async function deleteConfirmationMessage(interaction: {
  message: { delete(): Promise<unknown>; id: string };
}): Promise<void> {
  try {
    await interaction.message.delete();
  } catch (error: unknown) {
    logger.warn("確認メッセージの削除に失敗しました", {
      messageId: interaction.message.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * イベントをカレンダーに登録する共通処理
 */
async function registerEventToCalendar(
  interaction: ButtonInteraction,
  eventId: string,
  pending: ReturnType<typeof getPendingEvent>,
): Promise<void> {
  if (pending === undefined) {
    await interaction.followUp({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const result = await createCalendarEvent(pending.eventInfo);

  if (result.success) {
    removePendingEvent(eventId);

    // 確認メッセージを削除
    await deleteConfirmationMessage(interaction);

    // Ephemeral メッセージで通知
    const eventDetails = formatEventInfoForMessage(pending.eventInfo);
    await interaction.followUp({
      content: `✅ カレンダーに登録しました\n\n${eventDetails}\n\n📅 [カレンダーを開く](${CALENDAR_URL})${buildSurveySuffix()}`,
      flags: MessageFlags.Ephemeral,
    });

    logger.info("カレンダー登録が承認されました", {
      eventId,
      title: pending.eventInfo.title,
      userId: interaction.user.id,
    });
  } else {
    // 失敗時はメッセージを残してエラーを表示
    await interaction.editReply({
      content: `❌ 登録に失敗しました: ${result.reason}${buildSurveySuffix()}`,
      components: [],
    });

    logger.error("カレンダー登録に失敗しました", {
      eventId,
      reason: result.reason,
    });
  }
}

/**
 * 強制登録ボタンの処理（類似イベント警告後）
 */
async function handleForceRegisterButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(BUTTON_PREFIX.FORCE_REGISTER.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ このボタンは投稿者のみがクリックできます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // タイムアウトチェック
  if (isEventExpired(eventId)) {
    removePendingEvent(eventId);
    // まず Ephemeral メッセージで通知（インタラクションを応答）
    await interaction.reply({
      content: "⏰ タイムアウトしました。もう一度投稿してください。",
      flags: MessageFlags.Ephemeral,
    });
    // その後に確認メッセージを削除
    await deleteConfirmationMessage(interaction);
    return;
  }

  await interaction.deferUpdate();
  await registerEventToCalendar(interaction, eventId, pending);

  logger.info("類似イベント警告を無視して登録しました", {
    eventId,
    title: pending.eventInfo.title,
  });
}

/**
 * 強制キャンセルボタンの処理（類似イベント警告後）
 */
async function handleForceCancelButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(BUTTON_PREFIX.FORCE_CANCEL.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ このボタンは投稿者のみがクリックできます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  removePendingEvent(eventId);
  unmarkProcessed(pending.originalMessageId);

  // まず Ephemeral メッセージで通知（インタラクションを応答）
  await interaction.reply({
    content: `❌ キャンセルしました${buildSurveySuffix()}`,
    flags: MessageFlags.Ephemeral,
  });

  // その後に確認メッセージを削除
  await deleteConfirmationMessage(interaction);

  logger.info("類似イベント警告後にキャンセルされました", {
    eventId,
    title: pending.eventInfo.title,
    userId: interaction.user.id,
    originalMessageId: pending.originalMessageId,
  });
}

/**
 * 上書き更新ボタンの処理（類似イベント1件時）
 */
async function handleOverwriteButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(BUTTON_PREFIX.OVERWRITE.length);
  const pending = getPendingEvent(eventId);

  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ このボタンは投稿者のみがクリックできます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isEventExpired(eventId)) {
    removePendingEvent(eventId);
    await interaction.reply({
      content: "⏰ タイムアウトしました。もう一度投稿してください。",
      flags: MessageFlags.Ephemeral,
    });
    await deleteConfirmationMessage(interaction);
    return;
  }

  const targetCalendarEventId = pending.overwriteTargetCalendarEventId;
  if (targetCalendarEventId === undefined) {
    await interaction.reply({
      content: "❌ 上書き対象のイベントが設定されていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  await overwriteEventOnCalendar(
    interaction,
    eventId,
    pending,
    targetCalendarEventId,
  );
}

/**
 * 上書き対象セレクトメニューの処理（類似イベント複数件時）
 */
async function handleOverwriteSelect(
  interaction: StringSelectMenuInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(SELECT_PREFIX.OVERWRITE_TARGET.length);
  const pending = getPendingEvent(eventId);

  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ この操作は投稿者のみが行えます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (isEventExpired(eventId)) {
    removePendingEvent(eventId);
    await interaction.reply({
      content: "⏰ タイムアウトしました。もう一度投稿してください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const selectedCalendarEventId = interaction.values[0];
  if (selectedCalendarEventId === undefined) {
    await interaction.reply({
      content: "❌ イベントが選択されていません",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();
  await overwriteEventOnCalendar(
    interaction,
    eventId,
    pending,
    selectedCalendarEventId,
  );
}

/**
 * 既存イベントを上書き更新する共通処理
 */
async function overwriteEventOnCalendar(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  eventId: string,
  pending: PendingEvent,
  targetCalendarEventId: string,
): Promise<void> {
  const result = await updateCalendarEvent(
    targetCalendarEventId,
    pending.eventInfo,
  );

  if (result.success) {
    removePendingEvent(eventId);
    await deleteConfirmationMessage(interaction);

    const eventDetails = formatEventInfoForMessage(pending.eventInfo);
    await interaction.followUp({
      content: `✅ 既存イベントを上書き更新しました\n\n${eventDetails}\n\n📅 [カレンダーを開く](${CALENDAR_URL})${buildSurveySuffix()}`,
      flags: MessageFlags.Ephemeral,
    });

    logger.info("既存イベントを上書き更新しました", {
      eventId,
      calendarEventId: targetCalendarEventId,
      title: pending.eventInfo.title,
      userId: interaction.user.id,
    });
  } else {
    await interaction.editReply({
      content: `❌ 上書き更新に失敗しました: ${result.reason}${buildSurveySuffix()}`,
      components: [],
    });

    logger.error("カレンダー上書き更新に失敗しました", {
      eventId,
      calendarEventId: targetCalendarEventId,
      reason: result.reason,
    });
  }
}

/**
 * キャンセルボタンの処理
 */
async function handleCancelButton(
  interaction: ButtonInteraction,
  customId: string,
): Promise<void> {
  const eventId = customId.slice(BUTTON_PREFIX.CANCEL.length);
  const pending = getPendingEvent(eventId);

  // イベントが見つからない場合
  if (pending === undefined) {
    await interaction.reply({
      content: "❌ このイベントは既に処理されたか、タイムアウトしました",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // 投稿者以外はクリック不可
  if (interaction.user.id !== pending.userId) {
    await interaction.reply({
      content: "❌ このボタンは投稿者のみがクリックできます",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  removePendingEvent(eventId);
  unmarkProcessed(pending.originalMessageId);

  // まず Ephemeral メッセージで通知（インタラクションを応答）
  await interaction.reply({
    content: `❌ キャンセルしました${buildSurveySuffix()}`,
    flags: MessageFlags.Ephemeral,
  });

  // その後に確認メッセージを削除
  await deleteConfirmationMessage(interaction);

  logger.info("カレンダー登録がキャンセルされました", {
    eventId,
    title: pending.eventInfo.title,
    userId: interaction.user.id,
    originalMessageId: pending.originalMessageId,
  });
}

/**
 * interactionCreate イベントを登録する
 * @param client Discord Client
 */
export function registerInteractionHandler(client: Client): void {
  client.on("interactionCreate", (interaction) => {
    handleButtonClick(interaction).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error("インタラクション処理中にエラーが発生しました", {
          error: error.message,
        });
      }
    });
  });

  logger.info("interactionCreate ハンドラを登録しました");
}
