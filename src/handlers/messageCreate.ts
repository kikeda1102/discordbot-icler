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
} from 'discord.js';
import { extractXUrls } from '../services/urlExtractor.js';
import {
  extractEventFromMessage,
  reExtractEventWithCorrection,
} from '../services/eventExtractor.js';
import { logger } from '../utils/logger.js';
import { formatDateTimeJapanese } from '../utils/dateFormatter.js';
import type { EventInfo, SerializedEmbed } from '../types/index.js';
import {
  addPendingEvent,
  getEventIdByMessageId,
  getPendingEvent,
  updatePendingEvent,
} from '../stores/pendingEvents.js';

/** 指定ミリ秒待機する */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Discord Embed をシリアライズ可能な形式に変換する
 */
function serializeEmbed(embed: Embed): SerializedEmbed {
  return {
    title: embed.title,
    description: embed.description,
    url: embed.url,
    author: embed.author?.name !== undefined ? { name: embed.author.name } : null,
    fields: embed.fields.map((f) => ({ name: f.name, value: f.value })),
    image: embed.image?.url !== undefined ? { url: embed.image.url } : null,
    thumbnail: embed.thumbnail?.url !== undefined ? { url: embed.thumbnail.url } : null,
  };
}

/**
 * イベント情報から確認メッセージの内容を生成する
 */
function buildConfirmationContent(eventInfo: EventInfo, originalUrl: string): string {
  const lines: string[] = ['📋 **イベント情報を検出しました**\n'];

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

  if (eventInfo.location !== undefined && eventInfo.location !== '') {
    lines.push(`**場所:** ${eventInfo.location}`);
  }

  lines.push('');
  lines.push(`元のツイート: ${originalUrl}`);

  return lines.join('\n');
}

/**
 * 確認メッセージを送信する
 */
async function sendConfirmationMessage(
  message: Message,
  eventInfo: EventInfo,
  originalUrl: string,
  content: string,
  embeds: Embed[]
): Promise<void> {
  // 確認メッセージの内容を生成
  const confirmationContent = buildConfirmationContent(eventInfo, originalUrl);

  // まず仮のIDでボタンを作成（後で更新）
  const tempId = 'temp';
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_register_${tempId}`)
      .setLabel('登録する')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${tempId}`)
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('event_help')
      .setLabel('使い方')
      .setStyle(ButtonStyle.Secondary)
  );

  // 確認メッセージを送信
  const confirmationMessage = await message.reply({
    content: confirmationContent,
    components: [row],
  });

  // pendingEvents に登録して eventId を取得
  const eventId = addPendingEvent({
    eventInfo,
    userId: message.author.id,
    confirmationMessageId: confirmationMessage.id,
    channelId: message.channelId,
    originalContent: content,
    originalEmbeds: embeds.map(serializeEmbed),
    originalUrl,
  });

  // 正しい eventId でボタンを更新
  const updatedRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_register_${eventId}`)
      .setLabel('登録する')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${eventId}`)
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('event_help')
      .setLabel('使い方')
      .setStyle(ButtonStyle.Secondary)
  );

  await confirmationMessage.edit({
    content: confirmationContent,
    components: [updatedRow],
  });

  logger.info('確認メッセージを送信しました', {
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
  eventId: string
): Promise<void> {
  const pending = getPendingEvent(eventId);
  if (pending === undefined) {
    logger.warn('修正対象のイベントが見つかりません', { eventId });
    return;
  }

  // 投稿者以外は修正不可
  if (message.author.id !== pending.userId) {
    await message.reply({
      content: '❌ 修正は元の投稿者のみが行えます',
    });
    return;
  }

  const correction = message.content;

  logger.info('修正指示を受け付けました', {
    eventId,
    correction,
  });

  // 修正指示を含めて再抽出
  const result = await reExtractEventWithCorrection(
    pending.originalContent,
    pending.originalEmbeds,
    pending.originalUrl,
    correction
  );

  if (!result.success) {
    await message.reply({
      content: `❌ 再抽出に失敗しました: ${result.reason}`,
    });
    return;
  }

  // 新しい確認メッセージを送信
  const confirmationContent = buildConfirmationContent(result.data, pending.originalUrl);

  const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_register_${eventId}`)
      .setLabel('登録する')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`event_cancel_${eventId}`)
      .setLabel('キャンセル')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('event_help')
      .setLabel('使い方')
      .setStyle(ButtonStyle.Secondary)
  );

  const newConfirmationMessage = await message.reply({
    content: confirmationContent,
    components: [newRow],
  });

  // 古い確認メッセージのボタンを無効化
  try {
    const channel = message.channel;
    const oldMessage = await channel.messages.fetch(pending.confirmationMessageId);
    await oldMessage.edit({
      content: oldMessage.content + '\n\n*（修正されました）*',
      components: [],
    });
  } catch (error: unknown) {
    logger.warn('古い確認メッセージの更新に失敗しました', {
      messageId: pending.confirmationMessageId,
    });
  }

  // pendingEvent を更新
  updatePendingEvent(eventId, {
    eventInfo: result.data,
    confirmationMessageId: newConfirmationMessage.id,
  });

  logger.info('修正された確認メッセージを送信しました', {
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
 * Discord メッセージからイベント情報を抽出し、確認メッセージを送信する
 * @param message Discord メッセージ
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

  // 確認メッセージを送信
  await sendConfirmationMessage(message, eventResult.data, url, content, embeds);
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
