/**
 * イベント情報抽出サービス
 * Anthropic API を使用してツイートからイベント情報を抽出する
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Result, TweetInfo, EventInfo } from '../types/index.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

/** 使用するモデル */
const MODEL = 'claude-sonnet-4-20250514';

/** イベント抽出のプロンプト */
const EXTRACTION_PROMPT = `あなたはツイートからクラブイベント情報を抽出するアシスタントです。

以下のツイートからイベント情報を抽出してください。

**抽出する情報:**
- イベント名（title）: イベントの名前
- 開始日時（startTime）: ISO 8601 形式（例: 2025-02-15T22:00:00+09:00）
- 終了日時（endTime）: ISO 8601 形式。不明な場合は開始から4時間後と仮定
- 場所（location）: 開催場所。不明な場合は空文字
- 説明（description）: イベントの詳細説明

**ルール:**
- 日時が曖昧な場合（例: "2/15"）は、今年の日付として解釈し、時刻が不明な場合は22:00開始と仮定
- クラブイベントは通常22:00〜翌5:00頃なので、終了時刻が不明な場合はそのように推定
- 情報が全く読み取れない場合は、title を "不明なイベント" として返す

**出力形式:**
JSON形式で以下のように返してください。コードブロックは不要です。
{
  "title": "イベント名",
  "startTime": "2025-02-15T22:00:00+09:00",
  "endTime": "2025-02-16T05:00:00+09:00",
  "location": "場所",
  "description": "説明"
}`;

/** Anthropic API レスポンスからパースしたイベント情報 */
interface ParsedEventInfo {
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

/**
 * Anthropic API クライアントを作成する
 */
function createAnthropicClient(): Anthropic {
  const config = getConfig();
  return new Anthropic({
    apiKey: config.anthropic.apiKey,
  });
}

/**
 * ツイートからイベント情報を抽出する
 * @param tweet ツイート情報
 * @param originalUrl 元のツイートURL
 * @returns 抽出されたイベント情報
 */
export async function extractEventInfo(
  tweet: TweetInfo,
  originalUrl: string
): Promise<Result<EventInfo>> {
  const client = createAnthropicClient();

  const userMessage = `ツイート投稿者: @${tweet.authorUsername}
投稿日時: ${tweet.createdAt.toISOString()}

ツイート本文:
${tweet.text}`;

  try {
    logger.info('イベント情報の抽出を開始します', {
      tweetId: tweet.id,
      authorUsername: tweet.authorUsername,
    });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    });

    // レスポンスからテキストを取得
    const textBlock = response.content.find((block) => block.type === 'text');
    if (textBlock === undefined || textBlock.type !== 'text') {
      logger.error('Anthropic API からテキストレスポンスがありません', {
        tweetId: tweet.id,
      });
      return {
        success: false,
        reason: 'Anthropic API からテキストレスポンスがありません',
      };
    }

    // JSONをパース
    const parseResult = parseEventJson(textBlock.text);
    if (!parseResult.success) {
      return parseResult;
    }

    const parsed = parseResult.data;

    // Date オブジェクトに変換
    const startTime = new Date(parsed.startTime);
    const endTime = new Date(parsed.endTime);

    // 日付の妥当性チェック
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      logger.error('抽出された日時が不正です', {
        tweetId: tweet.id,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
      });
      return {
        success: false,
        reason: '抽出された日時の形式が不正です',
      };
    }

    // EventInfo を構築（location は空文字でないときのみ設定）
    const eventInfo: EventInfo =
      parsed.location !== ''
        ? {
            title: parsed.title,
            description: parsed.description,
            startTime,
            endTime,
            location: parsed.location,
            url: originalUrl,
          }
        : {
            title: parsed.title,
            description: parsed.description,
            startTime,
            endTime,
            url: originalUrl,
          };

    logger.info('イベント情報を抽出しました', {
      tweetId: tweet.id,
      title: eventInfo.title,
      startTime: eventInfo.startTime.toISOString(),
      endTime: eventInfo.endTime.toISOString(),
    });

    return {
      success: true,
      data: eventInfo,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : '不明なエラー';
    logger.error('イベント情報の抽出中にエラーが発生しました', {
      tweetId: tweet.id,
      error: errorMessage,
    });
    return {
      success: false,
      reason: `イベント抽出エラー: ${errorMessage}`,
    };
  }
}

/**
 * JSON文字列をパースしてイベント情報を取得する
 */
function parseEventJson(jsonString: string): Result<ParsedEventInfo> {
  try {
    // JSONブロックを抽出（```json ... ``` 形式の場合に対応）
    let cleanJson = jsonString.trim();
    const codeBlockMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch !== null && codeBlockMatch[1] !== undefined) {
      cleanJson = codeBlockMatch[1].trim();
    }

    const parsed: unknown = JSON.parse(cleanJson);

    // 型検証
    if (!isValidParsedEventInfo(parsed)) {
      logger.error('抽出されたJSONの形式が不正です', { json: cleanJson });
      return {
        success: false,
        reason: '抽出されたJSONの形式が不正です',
      };
    }

    return {
      success: true,
      data: parsed,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : '不明なエラー';
    logger.error('JSONのパースに失敗しました', {
      error: errorMessage,
      json: jsonString,
    });
    return {
      success: false,
      reason: `JSONパースエラー: ${errorMessage}`,
    };
  }
}

/**
 * パースされたオブジェクトが正しい形式かチェック
 */
function isValidParsedEventInfo(value: unknown): value is ParsedEventInfo {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (
    'title' in value &&
    typeof value.title === 'string' &&
    'startTime' in value &&
    typeof value.startTime === 'string' &&
    'endTime' in value &&
    typeof value.endTime === 'string' &&
    'location' in value &&
    typeof value.location === 'string' &&
    'description' in value &&
    typeof value.description === 'string'
  );
}
