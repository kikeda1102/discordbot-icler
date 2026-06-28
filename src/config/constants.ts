/**
 * アプリケーション定数（SSOT）
 */

/** 確認待ちイベントのタイムアウト時間（分） */
export const PENDING_EVENT_TIMEOUT_MINUTES = 10;

/** 確認待ちイベントのタイムアウト時間（ミリ秒） */
export const PENDING_EVENT_TIMEOUT_MS =
  PENDING_EVENT_TIMEOUT_MINUTES * 60 * 1000;

/** embed フォールバックタイムアウト時間（ミリ秒） */
export const EMBED_FALLBACK_TIMEOUT_MS = 30 * 1000;
