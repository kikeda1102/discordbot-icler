/**
 * messageCreate イベントハンドラ
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type Client,
  type Embed,
  type Message,
} from "discord.js";
import { extractXUrls } from "../services/urlExtractor.js";
import {
  extractEventFromMessage,
  reExtractEventWithCorrection,
  NOT_EVENT_REASON,
} from "../services/eventExtractor.js";
import { logger } from "../utils/logger.js";
import { formatDateTimeJapanese } from "../utils/dateFormatter.js";
import type { EventInfo, SerializedEmbed } from "../types/index.js";
import {
  addPendingEvent,
  generateEventId,
  getEventIdByMessageId,
  getPendingEvent,
  updatePendingEvent,
} from "../stores/pendingEvents.js";
import {
  isProcessed,
  markProcessed,
  unmarkProcessed,
} from "../stores/processedMessages.js";
import {
  isAwaiting,
  registerAwaiting,
  removeAwaiting,
} from "../stores/awaitingEmbeds.js";
import { EMBED_FALLBACK_TIMEOUT_MS } from "../config/constants.js";

/** イベント抽出処理の結果分類 */
export type ExtractionOutcome = "success" | "notEvent" | "failure";

/**
 * 処理済みマークを解除すべきか
 * 全 URL が確認メッセージなしで終わり、かつ一時的失敗（API エラー等）を含む場合のみ true。
 * 成功が 1 つでもあれば解除しない（messageUpdate 再処理による確認メッセージの二重送信を防ぐ）。
 * 全て notEvent の場合も解除しない（非イベントツイートの再抽出ループを防ぐ）。
 */
export const shouldUnmarkProcessed = (
  outcomes: readonly ExtractionOutcome[],
): boolean => !outcomes.includes("success") && outcomes.includes("failure");

/**
 * Discord Embed をシリアライズ可能な形式に変換する
 */
function serializeEmbed(embed: Embed): SerializedEmbed {
  return {
    title: embed.title,
    description: embed.description,
    url: embed.url,
    author:
      embed.author?.name !== undefined ? { name: embed.author.name } : null,
    fields: embed.fields.map((f) => ({ name: f.name, value: f.value })),
    image: embed.image?.url !== undefined ? { url: embed.image.url } : null,
    thumbnail:
      embed.thumbnail?.url !== undefined ? { url: embed.thumbnail.url } : null,
  };
}

/**
 * イベント情報から確認メッセージの内容を生成する
 */
function buildConfirmationContent(
  eventInfo: EventInfo,
  originalUrl: string,
): string {
  const lines: string[] = ["📋 イベント情報を検出しました\n"];

  lines.push(`**タイトル:** ${eventInfo.title}`);

  const isAllDay = eventInfo.isAllDay === true;
  if (isAllDay) {
    const startDateStr = formatDateTimeJapanese(eventInfo.startTime, true);
    lines.push(`**日付:** ${startDateStr} ※時間不明`);
  } else {
    const startStr = formatDateTimeJapanese(eventInfo.startTime, false);
    const endStr = formatDateTimeJapanese(eventInfo.endTime, false);
    lines.push(`**日時:** ${startStr} 〜 ${endStr}`);
  }

  if (eventInfo.location !== undefined && eventInfo.location !== "") {
    lines.push(`**場所:** ${eventInfo.location}`);
  }

  lines.push("");
  lines.push(`元のツイート: ${originalUrl}`);

  return lines.join("\n");
}

/**
 * 確認メッセージを送信する
 */
async function sendConfirmationMessage(
  message: Message,
  eventInfo: EventInfo,
  originalUrl: string,
  content: string,
  embeds: Embed[],
): Promise<void> {
  const confirmationContent = buildConfirmationContent(eventInfo, originalUrl);

  // eventId を先に生成し、最初から正しい customId でボタンを作成する
  // （仮IDで送信→編集の2段階方式はレースコンディションを起こすため廃止）
  const eventId = generateEventId();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_register_${eventId}`)
      .setLabel("登録する")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${eventId}`)
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("event_help")
      .setLabel("使い方")
      .setStyle(ButtonStyle.Secondary),
  );

  const confirmationMessage = await message.reply({
    content: confirmationContent,
    components: [row],
  });

  addPendingEvent(eventId, {
    eventInfo,
    userId: message.author.id,
    originalMessageId: message.id,
    confirmationMessageId: confirmationMessage.id,
    channelId: message.channelId,
    originalContent: content,
    originalEmbeds: embeds.map(serializeEmbed),
    originalUrl,
  });

  logger.info("確認メッセージを送信しました", {
    eventId,
    messageId: confirmationMessage.id,
    title: eventInfo.title,
  });
}

/**
 * 確認メッセージへの返信（修正指示）を処理する
 */
async function handleCorrectionReply(
  message: Message,
  eventId: string,
): Promise<void> {
  const pending = getPendingEvent(eventId);
  if (pending === undefined) {
    logger.warn("修正対象のイベントが見つかりません", { eventId });
    return;
  }

  // 投稿者以外は修正不可
  if (message.author.id !== pending.userId) {
    await message.reply({
      content: "❌ 修正は元の投稿者のみが行えます",
    });
    return;
  }

  const correction = message.content;

  logger.info("修正指示を受け付けました", {
    eventId,
    correction,
  });

  // 修正指示を含めて再抽出
  const result = await reExtractEventWithCorrection(
    pending.originalContent,
    pending.originalEmbeds,
    pending.originalUrl,
    correction,
  );

  if (!result.success) {
    await message.reply({
      content: `❌ 再抽出に失敗しました: ${result.reason}`,
    });
    return;
  }

  // 新しい確認メッセージを送信
  const confirmationContent = buildConfirmationContent(
    result.data,
    pending.originalUrl,
  );

  const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_register_${eventId}`)
      .setLabel("登録する")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${eventId}`)
      .setLabel("キャンセル")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("event_help")
      .setLabel("使い方")
      .setStyle(ButtonStyle.Secondary),
  );

  const newConfirmationMessage = await message.reply({
    content: confirmationContent,
    components: [newRow],
  });

  // 古い確認メッセージのボタンを無効化
  try {
    const channel = message.channel;
    const oldMessage = await channel.messages.fetch(
      pending.confirmationMessageId,
    );
    await oldMessage.edit({
      content: oldMessage.content + "\n\n*（修正されました）*",
      components: [],
    });
  } catch (error: unknown) {
    logger.warn("古い確認メッセージの更新に失敗しました", {
      messageId: pending.confirmationMessageId,
    });
  }

  // pendingEvent を更新
  updatePendingEvent(eventId, {
    eventInfo: result.data,
    confirmationMessageId: newConfirmationMessage.id,
  });

  logger.info("修正された確認メッセージを送信しました", {
    eventId,
    title: result.data.title,
  });
}

/**
 * メッセージハンドラを作成する
 * @param channelIds 監視対象のチャンネルID配列
 * @param clientUserId Bot自身のユーザーID
 * @returns メッセージハンドラ関数
 */
function createMessageHandler(
  channelIds: string[],
  clientUserId: string,
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

    // 確認メッセージへの返信かどうかをチェック
    if (message.reference?.messageId !== undefined) {
      const eventId = getEventIdByMessageId(message.reference.messageId);
      if (eventId !== undefined) {
        await handleCorrectionReply(message, eventId);
        return;
      }
    }

    // X/Twitter URL を抽出
    const result = extractXUrls(message.content);

    if (!result.success) {
      // URLが見つからない場合は何もしない
      return;
    }

    const urls = result.data;

    if (message.embeds.length > 0) {
      // embed が既にある場合は即座に処理
      // markProcessed は最初の await より前に行う（messageUpdate との競合防止）
      markProcessed(message.id);

      logger.info("X/Twitter URL を検出しました", {
        urls,
        messageId: message.id,
        channelId: message.channelId,
      });

      logger.debug("embed あり、即時処理します", {
        messageId: message.id,
        embedCount: message.embeds.length,
      });

      const outcomes: ExtractionOutcome[] = [];
      for (const url of urls) {
        outcomes.push(
          await processEventExtraction(
            message,
            message.content,
            message.embeds,
            url,
          ),
        );
      }

      if (shouldUnmarkProcessed(outcomes)) {
        unmarkProcessed(message.id);
        logger.info(
          "embed 即時処理で一時的エラーが発生したため処理済みマークを解除しました",
          { messageId: message.id },
        );
      }
    } else {
      // embed がない場合は messageUpdate に委譲し、フォールバックタイマーを設定
      logger.debug("embed なし、messageUpdate を待機します", {
        messageId: message.id,
      });

      const capturedUrls = urls;
      const fallbackTimerId = setTimeout(() => {
        if (!isAwaiting(message.id)) {
          return;
        }
        removeAwaiting(message.id);
        if (isProcessed(message.id)) {
          return;
        }

        logger.info("フォールバックタイマーが発火しました", {
          messageId: message.id,
        });

        message
          .fetch()
          .then(async (refreshed) => {
            if (isProcessed(message.id)) {
              return;
            }
            markProcessed(message.id);

            const outcomes: ExtractionOutcome[] = [];
            for (const url of capturedUrls) {
              outcomes.push(
                await processEventExtraction(
                  refreshed,
                  refreshed.content,
                  refreshed.embeds,
                  url,
                ),
              );
            }

            // embed ありで一時的失敗した場合も解除し、後続 messageUpdate で再処理可能にする
            if (shouldUnmarkProcessed(outcomes)) {
              unmarkProcessed(message.id);
              logger.info(
                "フォールバック処理で一時的エラーが発生したため処理済みマークを解除しました",
                { messageId: message.id },
              );
            }

            if (
              !outcomes.includes("success") &&
              refreshed.embeds.length === 0
            ) {
              // embed が届かないまま失敗した場合は、embed 到着後の再処理に備えて解除する
              unmarkProcessed(message.id);
              logger.info(
                "embed が届かないまま抽出に失敗したため処理済みマークを解除しました",
                { messageId: message.id },
              );

              // 抽出中に embed が届いていた場合の取りこぼしを防ぐ
              const rechecked = await message.fetch();
              if (rechecked.embeds.length > 0 && !isProcessed(message.id)) {
                markProcessed(message.id);
                const recheckedOutcomes: ExtractionOutcome[] = [];
                for (const url of capturedUrls) {
                  recheckedOutcomes.push(
                    await processEventExtraction(
                      rechecked,
                      rechecked.content,
                      rechecked.embeds,
                      url,
                    ),
                  );
                }
                if (shouldUnmarkProcessed(recheckedOutcomes)) {
                  unmarkProcessed(message.id);
                  logger.info(
                    "フォールバック再処理で一時的エラーが発生したため処理済みマークを解除しました",
                    { messageId: message.id },
                  );
                }
              }
            }
          })
          .catch(async (error: unknown) => {
            if (error instanceof Error) {
              logger.warn("フォールバック fetch 失敗、キャッシュで処理を試みます", {
                messageId: message.id,
                error: error.message,
              });
            }
            // fetch 失敗時はキャッシュ上のメッセージで処理を試みる
            // markProcessed しないので、失敗しても messageUpdate 側で拾える
            for (const url of capturedUrls) {
              await processEventExtraction(
                message,
                message.content,
                message.embeds,
                url,
              );
            }
          });
      }, EMBED_FALLBACK_TIMEOUT_MS);

      registerAwaiting(message.id, fallbackTimerId);
    }
  };
}

/**
 * Discord メッセージからイベント情報を抽出し、確認メッセージを送信する
 * @param message Discord メッセージ
 * @param content メッセージ本文
 * @param embeds 埋め込み情報
 * @param url X/Twitter URL
 * @returns 抽出結果の分類（success / notEvent / failure）
 */
export async function processEventExtraction(
  message: Message,
  content: string,
  embeds: Embed[],
  url: string,
): Promise<ExtractionOutcome> {
  const eventResult = await extractEventFromMessage(content, embeds, url);
  if (!eventResult.success) {
    if (eventResult.reason !== NOT_EVENT_REASON) {
      logger.warn("イベント情報の抽出に失敗しました", {
        url,
        reason: eventResult.reason,
      });
    }
    return eventResult.reason === NOT_EVENT_REASON ? "notEvent" : "failure";
  }

  await sendConfirmationMessage(
    message,
    eventResult.data,
    url,
    content,
    embeds,
  );
  return "success";
}

/**
 * messageCreate イベントを登録する
 * @param client Discord Client
 * @param channelIds 監視対象のチャンネルID配列
 */
export function registerMessageHandler(
  client: Client,
  channelIds: string[],
): void {
  // client.user が null の場合は登録しない
  if (client.user === null) {
    logger.error("Client user が設定されていません");
    return;
  }

  const handler = createMessageHandler(channelIds, client.user.id);

  client.on("messageCreate", (message) => {
    handler(message).catch((error: unknown) => {
      if (error instanceof Error) {
        logger.error("メッセージ処理中にエラーが発生しました", {
          error: error.message,
          messageId: message.id,
        });
      }
    });
  });

  logger.debug("messageCreate ハンドラを登録しました", { channelIds });
}
