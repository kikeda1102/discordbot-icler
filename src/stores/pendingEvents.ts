/**
 * 確認待ちイベントのストア
 * メモリ内で管理（再起動で消える想定）
 */

import type { Client } from "discord.js";
import type { PendingEvent } from "../types/index.js";
import { logger } from "../utils/logger.js";
import { PENDING_EVENT_TIMEOUT_MS } from "../config/constants.js";
import { cleanupProcessedMessages } from "./processedMessages.js";
import { cleanupAwaiting } from "./awaitingEmbeds.js";

/** クリーンアップ間隔（ミリ秒）: 1分 */
const CLEANUP_INTERVAL_MS = 60 * 1000;

/** イベントIDから PendingEvent を引く Map */
const pendingEvents = new Map<string, PendingEvent>();

/** 確認メッセージIDからイベントIDを引く逆引き Map */
const messageToEventId = new Map<string, string>();

/** クリーンアップタイマーのID */
let cleanupTimerId: ReturnType<typeof setInterval> | null = null;

/**
 * イベントIDを生成する
 */
export const generateEventId = (): string => crypto.randomUUID();

/**
 * 確認待ちイベントを追加する
 * @param eventId 事前に生成されたイベントID
 * @param pendingEvent 追加するイベント情報
 */
export const addPendingEvent = (
  eventId: string,
  pendingEvent: Omit<PendingEvent, "createdAt">,
): void => {
  const fullEvent: PendingEvent = {
    ...pendingEvent,
    createdAt: Date.now(),
  };

  pendingEvents.set(eventId, fullEvent);
  messageToEventId.set(pendingEvent.confirmationMessageId, eventId);

  logger.debug("確認待ちイベントを追加しました", {
    eventId,
    confirmationMessageId: pendingEvent.confirmationMessageId,
    userId: pendingEvent.userId,
  });
};

/**
 * イベントIDで確認待ちイベントを取得する
 * @param eventId イベントID
 * @returns PendingEvent または undefined
 */
export function getPendingEvent(eventId: string): PendingEvent | undefined {
  return pendingEvents.get(eventId);
}

/**
 * 確認メッセージIDからイベントIDを取得する
 * @param messageId 確認メッセージID
 * @returns イベントID または undefined
 */
export function getEventIdByMessageId(messageId: string): string | undefined {
  return messageToEventId.get(messageId);
}

/**
 * 確認メッセージIDから確認待ちイベントを取得する
 * @param messageId 確認メッセージID
 * @returns PendingEvent または undefined
 */
export function getPendingEventByMessageId(
  messageId: string,
): PendingEvent | undefined {
  const eventId = messageToEventId.get(messageId);
  if (eventId === undefined) {
    return undefined;
  }
  return pendingEvents.get(eventId);
}

/**
 * 確認待ちイベントを削除する
 * @param eventId イベントID
 * @returns 削除に成功した場合は true
 */
export function removePendingEvent(eventId: string): boolean {
  const event = pendingEvents.get(eventId);
  if (event === undefined) {
    return false;
  }

  messageToEventId.delete(event.confirmationMessageId);
  pendingEvents.delete(eventId);

  logger.debug("確認待ちイベントを削除しました", { eventId });

  return true;
}

/**
 * 確認待ちイベントを更新する（修正機能用）
 * 古いメッセージIDの逆引きを削除し、新しいメッセージIDで登録する
 * @param eventId イベントID
 * @param updates 更新内容
 * @returns 更新に成功した場合は true
 */
export function updatePendingEvent(
  eventId: string,
  updates: Partial<Pick<PendingEvent, "eventInfo" | "confirmationMessageId" | "overwriteTargetCalendarEventId" | "similarEvents">>,
): boolean {
  const event = pendingEvents.get(eventId);
  if (event === undefined) {
    return false;
  }

  // 確認メッセージIDが変わる場合は逆引きMapを更新
  if (
    updates.confirmationMessageId !== undefined &&
    updates.confirmationMessageId !== event.confirmationMessageId
  ) {
    messageToEventId.delete(event.confirmationMessageId);
    messageToEventId.set(updates.confirmationMessageId, eventId);
  }

  // イベント情報を更新
  const updatedEvent: PendingEvent = {
    ...event,
    ...updates,
  };
  pendingEvents.set(eventId, updatedEvent);

  logger.debug("確認待ちイベントを更新しました", { eventId });

  return true;
}

/**
 * Discordの確認メッセージを削除する
 * @param client Discord Client
 * @param channelId チャンネルID
 * @param messageId メッセージID
 */
async function deleteDiscordMessage(
  client: Client,
  channelId: string,
  messageId: string,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel === null || !channel.isTextBased() || channel.isDMBased()) {
      logger.warn(
        "チャンネルが見つからないか、テキストチャンネルではありません",
        {
          channelId,
        },
      );
      return;
    }
    await channel.messages.delete(messageId);
    logger.info("タイムアウトした確認メッセージを削除しました", {
      channelId,
      messageId,
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.warn("確認メッセージの削除に失敗しました", {
        channelId,
        messageId,
        error: error.message,
      });
    }
  }
}

/**
 * タイムアウトした確認待ちイベントをクリーンアップする
 * @param client Discord Client
 */
async function cleanupExpiredEvents(client: Client): Promise<void> {
  const now = Date.now();
  const expiredEntries: Array<{ eventId: string; event: PendingEvent }> = [];

  for (const [eventId, event] of pendingEvents) {
    if (now - event.createdAt > PENDING_EVENT_TIMEOUT_MS) {
      expiredEntries.push({ eventId, event });
    }
  }

  for (const { eventId, event } of expiredEntries) {
    await deleteDiscordMessage(
      client,
      event.channelId,
      event.confirmationMessageId,
    );
    removePendingEvent(eventId);
    logger.info("タイムアウトした確認待ちイベントを削除しました", { eventId });
  }

  if (expiredEntries.length > 0) {
    logger.debug("クリーンアップ完了", {
      removedCount: expiredEntries.length,
      remainingCount: pendingEvents.size,
    });
  }
}

/**
 * 定期クリーンアップを開始する
 * @param client Discord Client（タイムアウト時のメッセージ削除に使用）
 */
export function startCleanupTimer(client: Client): void {
  if (cleanupTimerId !== null) {
    logger.warn("クリーンアップタイマーは既に起動しています");
    return;
  }

  cleanupTimerId = setInterval(() => {
    cleanupProcessedMessages();
    cleanupAwaiting();
    cleanupExpiredEvents(client).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error("クリーンアップ中にエラーが発生しました", {
          error: error.message,
        });
      }
    });
  }, CLEANUP_INTERVAL_MS);
  logger.info("確認待ちイベントのクリーンアップタイマーを開始しました", {
    intervalMs: CLEANUP_INTERVAL_MS,
    timeoutMs: PENDING_EVENT_TIMEOUT_MS,
  });
}

/**
 * 定期クリーンアップを停止する
 */
export function stopCleanupTimer(): void {
  if (cleanupTimerId !== null) {
    clearInterval(cleanupTimerId);
    cleanupTimerId = null;
    logger.info("確認待ちイベントのクリーンアップタイマーを停止しました");
  }
}

/**
 * イベントがタイムアウトしているかどうかを確認する
 * @param eventId イベントID
 * @returns タイムアウトしている場合は true、イベントが存在しない場合も true
 */
export function isEventExpired(eventId: string): boolean {
  const event = pendingEvents.get(eventId);
  if (event === undefined) {
    return true;
  }
  return Date.now() - event.createdAt > PENDING_EVENT_TIMEOUT_MS;
}
