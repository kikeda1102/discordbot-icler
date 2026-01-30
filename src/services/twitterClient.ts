/**
 * X API v2 クライアント
 * ツイートの取得を行う
 */

import type { Result, TweetInfo } from '../types/index.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

/** X API v2 ツイート取得エンドポイント */
const TWITTER_API_BASE = 'https://api.twitter.com/2';

/** X API v2 のツイートレスポンス型 */
interface TwitterApiTweetResponse {
  data?: {
    id: string;
    text: string;
    created_at?: string;
    author_id?: string;
  };
  includes?: {
    users?: Array<{
      id: string;
      username: string;
    }>;
  };
  errors?: Array<{
    title: string;
    detail: string;
    type: string;
  }>;
}

/**
 * URL からツイートIDを抽出する
 * @param url X/Twitter の URL
 * @returns ツイートID または null
 */
export function extractTweetId(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/);
  if (match === null) {
    return null;
  }
  return match[1] ?? null;
}

/**
 * X API v2 でツイートを取得する
 * @param tweetId ツイートID
 * @returns ツイート情報
 */
export async function fetchTweet(tweetId: string): Promise<Result<TweetInfo>> {
  const config = getConfig();

  const url = `${TWITTER_API_BASE}/tweets/${tweetId}?tweet.fields=created_at,author_id&expansions=author_id&user.fields=username`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.twitter.bearerToken}`,
      },
    });

    if (!response.ok) {
      const statusText = response.statusText;
      logger.error('X API リクエストが失敗しました', {
        status: response.status,
        statusText,
        tweetId,
      });
      return {
        success: false,
        reason: `X API エラー: ${response.status} ${statusText}`,
      };
    }

    const json: unknown = await response.json();

    // レスポンスの型検証
    if (!isTwitterApiResponse(json)) {
      logger.error('X API レスポンスの形式が不正です', { tweetId });
      return {
        success: false,
        reason: 'X API レスポンスの形式が不正です',
      };
    }

    // エラーチェック
    if (json.errors !== undefined && json.errors.length > 0) {
      const errorDetail = json.errors[0]?.detail ?? '不明なエラー';
      logger.error('X API からエラーが返されました', {
        tweetId,
        error: errorDetail,
      });
      return {
        success: false,
        reason: `X API エラー: ${errorDetail}`,
      };
    }

    // データが存在しない場合
    if (json.data === undefined) {
      logger.warn('ツイートが見つかりませんでした', { tweetId });
      return {
        success: false,
        reason: 'ツイートが見つかりませんでした',
      };
    }

    // ユーザー名を取得
    const authorId = json.data.author_id;
    let authorUsername = 'unknown';
    if (authorId !== undefined && json.includes?.users !== undefined) {
      const user = json.includes.users.find((u) => u.id === authorId);
      if (user !== undefined) {
        authorUsername = user.username;
      }
    }

    // 作成日時をパース
    const createdAtStr = json.data.created_at;
    const createdAt =
      createdAtStr !== undefined ? new Date(createdAtStr) : new Date();

    const tweetInfo: TweetInfo = {
      id: json.data.id,
      text: json.data.text,
      authorUsername,
      createdAt,
    };

    logger.info('ツイートを取得しました', {
      tweetId: tweetInfo.id,
      authorUsername: tweetInfo.authorUsername,
    });

    return {
      success: true,
      data: tweetInfo,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : '不明なエラー';
    logger.error('ツイート取得中にエラーが発生しました', {
      tweetId,
      error: errorMessage,
    });
    return {
      success: false,
      reason: `ツイート取得エラー: ${errorMessage}`,
    };
  }
}

/**
 * X API レスポンスの型ガード
 */
function isTwitterApiResponse(value: unknown): value is TwitterApiTweetResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // data フィールドのチェック（オプショナル）
  if ('data' in value && value.data !== undefined) {
    if (typeof value.data !== 'object' || value.data === null) {
      return false;
    }
    if (
      !('id' in value.data) ||
      !('text' in value.data) ||
      typeof value.data.id !== 'string' ||
      typeof value.data.text !== 'string'
    ) {
      return false;
    }
  }

  // errors フィールドのチェック（オプショナル）
  if ('errors' in value && value.errors !== undefined) {
    if (!Array.isArray(value.errors)) {
      return false;
    }
  }

  return true;
}
