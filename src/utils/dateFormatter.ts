/**
 * 日時フォーマットユーティリティ
 */

/**
 * 日時を日本語形式でフォーマットする
 * @param date フォーマット対象の日時
 * @param isAllDay 終日イベントかどうか（true の場合は時刻を省略）
 * @returns 日本語形式の日時文字列（例: 2024年1月15日(月) 19:00）
 */
export function formatDateTimeJapanese(date: Date, isAllDay: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  };

  if (!isAllDay) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }

  return date.toLocaleString('ja-JP', options);
}
