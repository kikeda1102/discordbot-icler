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

/** messageUpdate で処理する最大メッセージ経過時間（ミリ秒）: 5分 */
export const MESSAGE_UPDATE_MAX_AGE_MS = 5 * 60 * 1000;

/** 抽出イベント日付の過去許容範囲（ミリ秒）: 24時間 */
export const EVENT_START_MAX_PAST_MS = 24 * 60 * 60 * 1000;
