/**
 * イベント情報抽出サービス
 * Google Gemini API を使用して Discord メッセージからイベント情報を抽出する
 */

import type { Embed } from 'discord.js';
import type { Result, EventInfo } from '../types/index.js';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

/** Gemini API エンドポイント */
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** 使用するモデル */
const MODEL = 'gemini-2.0-flash-lite-001';

/** イベント抽出のプロンプト */
const EXTRACTION_PROMPT = `あなたはDiscordメッセージからクラブイベント情報を抽出するアシスタントです。

以下の情報からイベント情報を抽出してください。
メッセージにはX/Twitterリンクと、その埋め込みプレビュー（embed）が含まれている場合があります。

**重要: まずイベント情報かどうかを判断してください**
- クラブイベント、パーティー、ライブ、DJイベントなどの告知 → イベント情報
- 日常のツイート、ニュース、単なる宣伝、感想、写真共有など → イベント情報ではない

**抽出する情報（イベント情報の場合のみ）:**
- イベント名（title）: イベントの名前
- 開始日時（startTime）: ISO 8601 形式（例: 2025-02-15T22:00:00+09:00）
- 終了日時（endTime）: ISO 8601 形式。不明な場合は開始から4時間後と仮定
- 場所（location）: 開催場所。不明な場合は空文字
- 説明（description）: イベントの詳細説明

**ルール:**
- 日時が曖昧な場合（例: "2/15"）は、今年の日付として解釈し、時刻が不明な場合は22:00開始と仮定
- クラブイベントは通常22:00〜翌5:00頃なので、終了時刻が不明な場合はそのように推定
- メッセージ本文とembed両方の情報を活用してください

**出力形式:**
JSON形式で以下のように返してください。コードブロックは不要です。

イベント情報が含まれている場合:
{
  "isEvent": true,
  "title": "イベント名",
  "startTime": "2025-02-15T22:00:00+09:00",
  "endTime": "2025-02-16T05:00:00+09:00",
  "location": "場所",
  "description": "説明"
}

イベント情報が含まれていない場合（日常のツイート、ニュース、宣伝など）:
{
  "isEvent": false,
  "title": "",
  "startTime": "",
  "endTime": "",
  "location": "",
  "description": ""
}`;

/** パースしたイベント情報 */
interface ParsedEventInfo {
  isEvent: boolean;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

/** Gemini API レスポンスの型 */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Gemini API を呼び出す
 */
async function callGeminiApi(prompt: string): Promise<Result<string>> {
  const config = getConfig();
  const url = `${GEMINI_API_BASE}/models/${MODEL}:generateContent?key=${config.gemini.apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        reason: `Gemini API エラー: ${response.status} ${errorText}`,
      };
    }

    const json: unknown = await response.json();

    if (!isGeminiResponse(json)) {
      return {
        success: false,
        reason: 'Gemini API レスポンスの形式が不正です',
      };
    }

    if (json.error !== undefined) {
      return {
        success: false,
        reason: `Gemini API エラー: ${json.error.message}`,
      };
    }

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text === undefined) {
      return {
        success: false,
        reason: 'Gemini API からテキストレスポンスがありません',
      };
    }

    return {
      success: true,
      data: text,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : '不明なエラー';
    return {
      success: false,
      reason: `Gemini API 呼び出しエラー: ${errorMessage}`,
    };
  }
}

/**
 * Gemini API レスポンスの型ガード
 */
function isGeminiResponse(value: unknown): value is GeminiResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return true;
}

/**
 * Discord メッセージからイベント情報を抽出する
 * @param content メッセージ本文
 * @param embeds 埋め込み情報
 * @param originalUrl 元のツイートURL
 * @returns 抽出されたイベント情報
 */
export async function extractEventFromMessage(
  content: string,
  embeds: Embed[],
  originalUrl: string
): Promise<Result<EventInfo>> {
  // embed 情報を文字列化
  const embedTexts = embeds
    .map((embed) => {
      const parts: string[] = [];
      if (embed.author?.name !== undefined) {
        parts.push(`投稿者: ${embed.author.name}`);
      }
      if (embed.title !== null) {
        parts.push(`タイトル: ${embed.title}`);
      }
      if (embed.description !== null) {
        parts.push(`内容: ${embed.description}`);
      }
      if (embed.fields.length > 0) {
        const fieldTexts = embed.fields.map((f) => `${f.name}: ${f.value}`);
        parts.push(`フィールド:\n${fieldTexts.join('\n')}`);
      }
      return parts.join('\n');
    })
    .filter((text) => text.length > 0);

  const userMessage = `**Discordメッセージ本文:**
${content}

**埋め込み情報（embed）:**
${embedTexts.length > 0 ? embedTexts.join('\n\n---\n\n') : '（なし）'}

**元のURL:** ${originalUrl}`;

  const fullPrompt = `${EXTRACTION_PROMPT}

---

${userMessage}`;

  logger.info('イベント情報の抽出を開始します', {
    url: originalUrl,
    contentLength: content.length,
    embedCount: embeds.length,
  });

  // Gemini API を呼び出し
  const apiResult = await callGeminiApi(fullPrompt);
  if (!apiResult.success) {
    logger.error('Gemini API 呼び出しに失敗しました', {
      url: originalUrl,
      reason: apiResult.reason,
    });
    return apiResult;
  }

  // JSONをパース
  const parseResult = parseEventJson(apiResult.data);
  if (!parseResult.success) {
    return parseResult;
  }

  const parsed = parseResult.data;

  // イベント情報でない場合はスキップ
  if (!parsed.isEvent) {
    logger.info('イベント情報ではないためスキップします', { url: originalUrl });
    return {
      success: false,
      reason: 'イベント情報が含まれていません',
    };
  }

  // Date オブジェクトに変換
  const startTime = new Date(parsed.startTime);
  const endTime = new Date(parsed.endTime);

  // 日付の妥当性チェック
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    logger.error('抽出された日時が不正です', {
      url: originalUrl,
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
    url: originalUrl,
    title: eventInfo.title,
    startTime: eventInfo.startTime.toISOString(),
    endTime: eventInfo.endTime.toISOString(),
  });

  return {
    success: true,
    data: eventInfo,
  };
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
    'isEvent' in value &&
    typeof value.isEvent === 'boolean' &&
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
