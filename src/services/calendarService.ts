/**
 * Google Calendar API クライアント
 */

import { google, calendar_v3 } from "googleapis";
import type { Result, EventInfo, SimilarEvent } from "../types/index.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Google Calendar クライアントを取得する */
function getCalendarClient(): calendar_v3.Calendar {
  const config = getConfig();
  const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
  );
  oauth2Client.setCredentials({
    refresh_token: config.google.refreshToken,
  });
  return google.calendar({ version: "v3", auth: oauth2Client });
}

/**
 * Date を JST ローカル時間形式の文字列に変換する
 * Google Calendar API で timeZone: 'Asia/Tokyo' と組み合わせて使用
 */
function formatDateTimeForJST(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

/**
 * Date を日付のみの文字列に変換する（終日イベント用）
 * @param date 日付
 * @returns YYYY-MM-DD 形式の文字列
 */
function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** EventInfo を Google Calendar イベント形式に変換 */
function toCalendarEvent(eventInfo: EventInfo): calendar_v3.Schema$Event {
  // description に Twitter URL を含める
  const descriptionParts: string[] = [eventInfo.description];
  if (eventInfo.url !== undefined) {
    descriptionParts.push("");
    descriptionParts.push(`source: ${eventInfo.url}`);
  }

  const baseEvent: calendar_v3.Schema$Event =
    eventInfo.isAllDay === true
      ? {
          summary: eventInfo.title,
          description: descriptionParts.join("\n"),
          start: {
            date: formatDateOnly(eventInfo.startTime),
          },
          end: {
            date: formatDateOnly(eventInfo.endTime),
          },
        }
      : {
          summary: eventInfo.title,
          description: descriptionParts.join("\n"),
          start: {
            dateTime: formatDateTimeForJST(eventInfo.startTime),
            timeZone: "Asia/Tokyo",
          },
          end: {
            dateTime: formatDateTimeForJST(eventInfo.endTime),
            timeZone: "Asia/Tokyo",
          },
        };

  return eventInfo.location !== undefined
    ? { ...baseEvent, location: eventInfo.location }
    : baseEvent;
}

/**
 * 文字列が別の文字列を含むかチェック（大文字小文字・全角半角を無視）
 */
function containsIgnoreCase(text: string, search: string): boolean {
  const normalize = (s: string): string =>
    s
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[\s\u3000]+/g, ""); // スペースと全角スペースを除去
  return normalize(text).includes(normalize(search));
}

/**
 * 指定された日付範囲のイベントを取得する
 */
async function getEventsInDateRange(
  startDate: Date,
  endDate: Date
): Promise<Result<calendar_v3.Schema$Event[]>> {
  const config = getConfig();
  const calendar = getCalendarClient();

  try {
    const response = await calendar.events.list({
      calendarId: config.google.calendarId,
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    return {
      success: true,
      data: response.data.items ?? [],
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    logger.error("イベント一覧の取得に失敗しました", { error: errorMessage });
    return {
      success: false,
      reason: `イベント取得エラー: ${errorMessage}`,
    };
  }
}

/**
 * Google Calendarのイベントから開始時刻の表示文字列を取得
 */
function formatEventStartTime(event: calendar_v3.Schema$Event): string {
  const start = event.start;
  if (start === undefined || start === null) {
    return "日時不明";
  }

  // 終日イベントの場合
  if (start.date !== undefined && start.date !== null) {
    const [year, month, day] = start.date.split("-");
    return `${year}/${month}/${day}（終日）`;
  }

  // 時刻指定イベントの場合
  if (start.dateTime !== undefined && start.dateTime !== null) {
    const date = new Date(start.dateTime);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}/${month}/${day} ${hours}:${minutes}〜`;
  }

  return "日時不明";
}

/**
 * 類似イベントを検索する
 * 同じ日付でタイトルまたは場所が部分一致するイベントを返す
 */
export async function findSimilarEvents(
  eventInfo: EventInfo
): Promise<Result<SimilarEvent[]>> {
  // 検索対象の日付範囲を設定（開始日の0:00〜23:59:59）
  const searchStart = new Date(eventInfo.startTime);
  searchStart.setHours(0, 0, 0, 0);

  const searchEnd = new Date(eventInfo.startTime);
  searchEnd.setHours(23, 59, 59, 999);

  const result = await getEventsInDateRange(searchStart, searchEnd);
  if (!result.success) {
    return result;
  }

  const similarEvents: SimilarEvent[] = [];

  for (const event of result.data) {
    const eventTitle = event.summary ?? "";
    const eventLocation = event.location ?? "";

    // タイトルの部分一致チェック
    const titleMatches =
      eventInfo.title.length > 0 &&
      (containsIgnoreCase(eventTitle, eventInfo.title) ||
        containsIgnoreCase(eventInfo.title, eventTitle));

    // 場所の部分一致チェック（場所が指定されている場合のみ）
    const locationMatches =
      eventInfo.location !== undefined &&
      eventInfo.location.length > 0 &&
      eventLocation.length > 0 &&
      (containsIgnoreCase(eventLocation, eventInfo.location) ||
        containsIgnoreCase(eventInfo.location, eventLocation));

    if (titleMatches || locationMatches) {
      const eventId = event.id;
      if (eventId !== undefined && eventId !== null) {
        const baseSimilarEvent = {
          id: eventId,
          title: eventTitle,
          startTime: formatEventStartTime(event),
        };
        const similarEvent: SimilarEvent =
          eventLocation.length > 0
            ? { ...baseSimilarEvent, location: eventLocation }
            : baseSimilarEvent;
        similarEvents.push(similarEvent);
      }
    }
  }

  logger.info("類似イベント検索完了", {
    searchDate: formatDateOnly(eventInfo.startTime),
    foundCount: similarEvents.length,
  });

  return {
    success: true,
    data: similarEvents,
  };
}

/** 既存イベントを上書き更新する */
export async function updateCalendarEvent(
  calendarEventId: string,
  eventInfo: EventInfo,
): Promise<Result<string>> {
  const config = getConfig();
  const calendar = getCalendarClient();
  const event = toCalendarEvent(eventInfo);

  try {
    const response = await calendar.events.update({
      calendarId: config.google.calendarId,
      eventId: calendarEventId,
      requestBody: event,
    });

    const responseId = response.data.id;
    if (responseId === undefined || responseId === null) {
      return {
        success: false,
        reason: "イベントIDが取得できませんでした",
      };
    }

    logger.info("Google Calendar のイベントを上書き更新しました", {
      eventId: responseId,
      title: eventInfo.title,
    });

    return {
      success: true,
      data: responseId,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    logger.error("Google Calendar 上書き更新に失敗しました", {
      error: errorMessage,
      title: eventInfo.title,
    });
    return {
      success: false,
      reason: `Google Calendar 上書き更新エラー: ${errorMessage}`,
    };
  }
}

/** イベントを Google Calendar に登録する */
export async function createCalendarEvent(
  eventInfo: EventInfo,
): Promise<Result<string>> {
  const config = getConfig();
  const calendar = getCalendarClient();
  const event = toCalendarEvent(eventInfo);

  try {
    const response = await calendar.events.insert({
      calendarId: config.google.calendarId,
      requestBody: event,
    });

    const eventId = response.data.id;
    if (eventId === undefined || eventId === null) {
      return {
        success: false,
        reason: "イベントIDが取得できませんでした",
      };
    }

    logger.info("Google Calendar にイベントを登録しました", {
      eventId,
      title: eventInfo.title,
    });

    return {
      success: true,
      data: eventId,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    logger.error("Google Calendar 登録に失敗しました", {
      error: errorMessage,
      title: eventInfo.title,
    });
    return {
      success: false,
      reason: `Google Calendar 登録エラー: ${errorMessage}`,
    };
  }
}
