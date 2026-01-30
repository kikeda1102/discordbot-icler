/**
 * イベント情報抽出サービス
 * Google Gemini API を使用して Discord メッセージからイベント情報を抽出する
 */

import type { Embed } from "discord.js";
import type { Result, EventInfo } from "../types/index.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";

/** Gemini API エンドポイント */
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** 使用するモデル */
const MODEL = "gemini-2.0-flash-lite-001";

/** リトライ設定（Google推奨の指数バックオフ + ジッター） */
const RETRY_CONFIG = {
  /** 最大リトライ回数 */
  maxRetries: 5,
  /** 初回待機時間（ミリ秒） */
  initialDelayMs: 1000,
  /** 最大待機時間（ミリ秒） */
  maxDelayMs: 60000,
  /** バックオフ倍率 */
  backoffMultiplier: 2,
} as const;

/**
 * 指定ミリ秒待機する
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * ジッター付き指数バックオフの待機時間を計算する
 * @param attempt リトライ回数（0始まり）
 * @returns 待機時間（ミリ秒）
 */
function calculateBackoffDelay(attempt: number): number {
  // 指数バックオフ: initialDelay * (multiplier ^ attempt)
  const exponentialDelay =
    RETRY_CONFIG.initialDelayMs *
    Math.pow(RETRY_CONFIG.backoffMultiplier, attempt);

  // 最大待機時間でキャップ
  const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.maxDelayMs);

  // ジッター: 0.5〜1.5倍のランダム変動を追加
  const jitter = 0.5 + Math.random();
  return Math.floor(cappedDelay * jitter);
}

/**
 * イベント抽出のプロンプトを生成する
 * @param currentDate 現在日時（日本時間）
 */
function buildExtractionPrompt(currentDate: string): string {
  return `あなたはDiscordメッセージからクラブイベント情報を抽出するアシスタントです。

**現在日時: ${currentDate}（日本時間）**

以下の情報からイベント情報を抽出してください。
メッセージにはX/Twitterリンクと、その埋め込みプレビュー（embed）が含まれている場合があります。

**重要: まずイベント情報かどうかを判断してください**
- クラブイベント、パーティー、ライブ、DJイベントなどの告知 → イベント情報
- 日常のツイート、ニュース、単なる宣伝、感想、写真共有など → イベント情報ではない

**抽出する情報（イベント情報の場合のみ）:**
- イベント名（title）: イベントの名前
- 時刻情報の有無（hasTime）: 開始時刻が明記されているかどうか
- 開始日時（startTime）: 時刻が明記されている場合は ISO 8601 形式（例: 2025-02-15T22:00:00+09:00）、時刻が不明な場合は日付のみ（例: 2025-02-15）
- 終了日時（endTime）: 時刻が明記されている場合は ISO 8601 形式、時刻が不明な場合は日付のみ（開始日の翌日）
- 場所（location）: 開催場所。不明な場合は空文字
- 説明（description）: イベントの詳細説明

**ルール:**
- イベントの日付は基本的に現在日時より未来です。過去の日付にならないよう注意してください
- 日時が曖昧な場合（例: "2/15"）は、現在日時より未来になる直近の日付として解釈してください
- 年が明記されていない場合、現在日時より未来になる年を選んでください（例: 現在が2026年1月で "5/25" なら 2026-05-25）
- **時刻が明記されていない場合**: hasTime を false にし、startTime/endTime は日付のみ（YYYY-MM-DD形式）を返してください。終日イベントとして登録します
- **時刻が明記されている場合**: hasTime を true にし、startTime/endTime は ISO 8601 形式で返してください
- メッセージ本文とembed両方の情報を活用してください

**出力形式:**
JSON形式で以下のように返してください。コードブロックは不要です。

イベント情報が含まれている場合（時刻あり）:
{
  "isEvent": true,
  "hasTime": true,
  "title": "イベント名",
  "startTime": "2025-02-15T22:00:00+09:00",
  "endTime": "2025-02-16T05:00:00+09:00",
  "location": "場所",
  "description": "説明"
}

イベント情報が含まれている場合（時刻なし・終日イベント）:
{
  "isEvent": true,
  "hasTime": false,
  "title": "イベント名",
  "startTime": "2025-02-15",
  "endTime": "2025-02-16",
  "location": "場所",
  "description": "説明"
}

イベント情報が含まれていない場合（日常のツイート、ニュース、宣伝など）:
{
  "isEvent": false,
  "hasTime": false,
  "title": "",
  "startTime": "",
  "endTime": "",
  "location": "",
  "description": ""
}`;
}

/** パースしたイベント情報 */
interface ParsedEventInfo {
  isEvent: boolean;
  hasTime: boolean;
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
 * Gemini API を呼び出す（429エラー時は自動リトライ）
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

  let lastError = "";

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      // 429 レート制限エラーの場合はリトライ
      if (response.status === 429) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn("Gemini API レート制限に達しました。リトライします", {
          attempt: attempt + 1,
          maxRetries: RETRY_CONFIG.maxRetries + 1,
          delayMs,
        });

        if (attempt < RETRY_CONFIG.maxRetries) {
          await sleep(delayMs);
          continue;
        }

        // 最大リトライ回数に達した
        return {
          success: false,
          reason: `Gemini API レート制限: ${RETRY_CONFIG.maxRetries + 1}回リトライしましたが失敗しました`,
        };
      }

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
          reason: "Gemini API レスポンスの形式が不正です",
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
          reason: "Gemini API からテキストレスポンスがありません",
        };
      }

      // リトライ成功時はログ出力
      if (attempt > 0) {
        logger.info("Gemini API リトライ成功", { attempt: attempt + 1 });
      }

      return {
        success: true,
        data: text,
      };
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : "不明なエラー";

      // ネットワークエラーもリトライ対象
      if (attempt < RETRY_CONFIG.maxRetries) {
        const delayMs = calculateBackoffDelay(attempt);
        logger.warn("Gemini API 呼び出しエラー。リトライします", {
          attempt: attempt + 1,
          maxRetries: RETRY_CONFIG.maxRetries + 1,
          delayMs,
          error: lastError,
        });
        await sleep(delayMs);
        continue;
      }
    }
  }

  return {
    success: false,
    reason: `Gemini API 呼び出しエラー: ${lastError}`,
  };
}

/**
 * Gemini API レスポンスの型ガード
 */
function isGeminiResponse(value: unknown): value is GeminiResponse {
  if (typeof value !== "object" || value === null) {
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
  originalUrl: string,
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
        parts.push(`フィールド:\n${fieldTexts.join("\n")}`);
      }
      return parts.join("\n");
    })
    .filter((text) => text.length > 0);

  const userMessage = `**Discordメッセージ本文:**
${content}

**埋め込み情報（embed）:**
${embedTexts.length > 0 ? embedTexts.join("\n\n---\n\n") : "（なし）"}

**元のURL:** ${originalUrl}`;

  // 現在日時を日本時間で取得
  const now = new Date();
  const currentDate = now.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const fullPrompt = `${buildExtractionPrompt(currentDate)}

---

${userMessage}`;

  logger.info("イベント情報の抽出を開始します", {
    url: originalUrl,
    contentLength: content.length,
    embedCount: embeds.length,
  });

  // Gemini API を呼び出し
  const apiResult = await callGeminiApi(fullPrompt);
  if (!apiResult.success) {
    logger.error("Gemini API 呼び出しに失敗しました", {
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
    logger.info("イベント情報ではないためスキップします", { url: originalUrl });
    return {
      success: false,
      reason: "イベント情報が含まれていません",
    };
  }

  // Date オブジェクトに変換
  const startTime = new Date(parsed.startTime);
  const endTime = new Date(parsed.endTime);

  // 日付の妥当性チェック
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    logger.error("抽出された日時が不正です", {
      url: originalUrl,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
    });
    return {
      success: false,
      reason: "抽出された日時の形式が不正です",
    };
  }

  // 終日イベントかどうか
  const isAllDay = !parsed.hasTime;

  // EventInfo を構築
  const eventInfo: EventInfo = {
    title: parsed.title,
    description: parsed.description,
    startTime,
    endTime,
    url: originalUrl,
    isAllDay,
  };

  // location は空文字でないときのみ設定
  if (parsed.location !== "") {
    eventInfo.location = parsed.location;
  }

  logger.info("イベント情報を抽出しました", {
    url: originalUrl,
    title: eventInfo.title,
    startTime: eventInfo.startTime.toISOString(),
    endTime: eventInfo.endTime.toISOString(),
    isAllDay,
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
    const cleanJson = (() => {
      const trimmed = jsonString.trim();
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch !== null && codeBlockMatch[1] !== undefined) {
        return codeBlockMatch[1].trim();
      }
      return trimmed;
    })();

    const parsed: unknown = JSON.parse(cleanJson);

    // 型検証
    if (!isValidParsedEventInfo(parsed)) {
      logger.error("抽出されたJSONの形式が不正です", { json: cleanJson });
      return {
        success: false,
        reason: "抽出されたJSONの形式が不正です",
      };
    }

    logger.info("Gemini APIからの抽出結果（デバッグ用）", {
      rawJson: cleanJson,
      parsedStartTime: parsed.startTime,
      parsedEndTime: parsed.endTime,
      parsedTitle: parsed.title,
    });

    return {
      success: true,
      data: parsed,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    logger.error("JSONのパースに失敗しました", {
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
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "isEvent" in value &&
    typeof value.isEvent === "boolean" &&
    "hasTime" in value &&
    typeof value.hasTime === "boolean" &&
    "title" in value &&
    typeof value.title === "string" &&
    "startTime" in value &&
    typeof value.startTime === "string" &&
    "endTime" in value &&
    typeof value.endTime === "string" &&
    "location" in value &&
    typeof value.location === "string" &&
    "description" in value &&
    typeof value.description === "string"
  );
}
