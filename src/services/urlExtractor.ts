/**
 * X/Twitter URL 抽出サービス
 */

import type { Result } from '../types/index.js';

/** X/Twitter ステータスURL のパターン */
const X_URL_PATTERN = /https?:\/\/(?:x\.com|twitter\.com)\/\w+\/status\/\d+/gi;

/**
 * テキストから X/Twitter URL を抽出する
 * @param content 検索対象のテキスト
 * @returns 抽出されたURLの配列、またはエラー
 */
export function extractXUrls(content: string): Result<string[]> {
  const matches = content.match(X_URL_PATTERN);

  if (matches === null || matches.length === 0) {
    return {
      success: false,
      reason: 'X/Twitter URL が見つかりませんでした',
    };
  }

  // 重複を除去
  const uniqueUrls = [...new Set(matches)];

  return {
    success: true,
    data: uniqueUrls,
  };
}

/**
 * テキストに X/Twitter URL が含まれているかチェック
 * @param content 検索対象のテキスト
 * @returns URLが含まれている場合は true
 */
export function hasXUrl(content: string): boolean {
  return X_URL_PATTERN.test(content);
}
