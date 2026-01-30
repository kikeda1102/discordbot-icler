/**
 * Google Calendar API クライアント
 */

import { google, calendar_v3 } from "googleapis";
import type { Result, EventInfo } from "../types/index.js";
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
