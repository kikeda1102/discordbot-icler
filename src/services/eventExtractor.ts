/**
 * イベント情報抽出サービス
 * LLM プロバイダーチェインを使用して Discord メッセージからイベント情報を抽出する
 */

import type { Embed } from "discord.js";
import type { Result, EventInfo, EmbedLike, EmbedWithImage, ParsedEventInfo } from "../types/index.js";
import type { LlmProvider } from "./providers/types.js";
import { getConfig } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { fetchMultipleImages } from "./imageService.js";
import { buildProviderChain, callLlmApi } from "./providers/providerChain.js";
import { sleep } from "./providers/retry.js";

/** 非イベント判定の失敗 reason（呼び出し側で一時的失敗と区別するための SSOT） */
export const NOT_EVENT_REASON = "イベント情報が含まれていません";

/** JSONパースエラー時のリトライ設定 */
const JSON_PARSE_RETRY_CONFIG = {
  maxRetries: 2,
  delayMs: 500,
};

/**
 * イベント抽出のプロンプトを生成する
 * @param currentDate 現在日時（日本時間）
 * @param hasImages 画像が含まれているかどうか
 */
function buildExtractionPrompt(
  currentDate: string,
  hasImages: boolean,
): string {
  const imageInstruction = hasImages
    ? `
**画像について（重要）:**
- 添付された画像はイベントのフライヤーや告知画像です
- **テキストと画像の両方を確認し、両方の情報を根拠にしてください**
- テキストと画像で日付が異なる場合は、より具体的で明確な情報を優先してください
- 画像内のテキストを注意深く読み取ってください
- **イベント名（タイトル）は通常、フライヤーの最も目立つ位置（上部や中央）に大きなフォントで表示されています**
- **出演者/DJ/アーティストの名前はタイトルではありません。「LINE UP」「出演」「GUEST」などの見出しの下や、小さめのフォントで記載されているものは出演者名です**`
    : "";

  return `あなたはDiscordメッセージからクラブイベント情報を抽出するアシスタントです。

**現在日時: ${currentDate}（日本時間）**

以下の情報からイベント情報を抽出してください。
メッセージにはX/Twitterリンクと、その埋め込みプレビュー（embed）が含まれている場合があります。
${imageInstruction}

**重要: まずイベント情報かどうかを判断してください**
- クラブイベント、パーティー、ライブ、DJイベントなどの告知 → イベント情報
- 日常のツイート、ニュース、単なる宣伝、感想、写真共有など → イベント情報ではない

**抽出する情報（イベント情報の場合のみ）:**
- イベント名（title）: イベントの正式名称。フライヤーの最も目立つ位置（上部や中央）に大きく表示されているテキストを優先。基本的にはツイートの本文に含まれており、含まれていない場合は間違っている可能性あるので注意すること。出演者名・アーティスト名・DJ名とは区別すること
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

**日付・時間の妥当性チェック（重要）:**
- **テキストと画像の両方を確認**: 日付情報はテキスト本文と画像フライヤーの両方から読み取り、矛盾がないか確認してください
- **告知時期の妥当性**: イベント告知は通常2週間〜3ヶ月前に行われます。現在日時から極端に離れた日付（1年以上先、または過去）は誤読の可能性が高いので再確認してください
- **開催時間の妥当性**: クラブイベントの開催時間は通常以下の範囲です：
  - 最短: 約2時間
  - 標準: 4〜6時間（例: 22:00〜04:00）
  - 長時間: 8〜10時間（例: 12:00〜22:00 または 21:00〜翌07:00）
  - これを大きく外れる場合は、日付や時刻の読み取り間違いの可能性があります

**出力形式:**
純粋なJSON形式のみで返してください。マークダウン記法（バッククォート \`\`\` など）は一切使用せず、JSONのみを出力してください。
文字列値内でバックスラッシュ（\\）によるエスケープは使用しないでください。特殊文字はそのまま記述してください。

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

/** プロバイダーチェインの遅延初期化 */
let providerChain: readonly LlmProvider[] | null = null;

const getProviderChain = (): readonly LlmProvider[] => {
  if (providerChain === null) {
    providerChain = buildProviderChain(getConfig());
    logger.info("LLM プロバイダーチェインを初期化しました", {
      providers: providerChain.map((p) => p.name),
    });
  }
  return providerChain;
};

/** プロバイダーチェインをリセットする（テスト用） */
export const resetProviderChain = (): void => {
  providerChain = null;
};

/**
 * Embed から画像URLを抽出する
 * Discord.js の Embed と SerializedEmbed の両方に対応
 * @param embeds EmbedWithImage の配列
 * @returns 画像URLの配列
 */
function extractImageUrls(embeds: readonly EmbedWithImage[]): string[] {
  const urls: string[] = [];

  for (const embed of embeds) {
    // メイン画像
    if (embed.image?.url !== undefined) {
      urls.push(embed.image.url);
    }
    // サムネイル画像
    if (embed.thumbnail?.url !== undefined) {
      urls.push(embed.thumbnail.url);
    }
  }

  return urls;
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
  // embed から画像URLを抽出
  const imageUrls = extractImageUrls(embeds);

  // 画像を取得してBase64エンコード
  const images = await fetchMultipleImages(imageUrls);

  // embed 情報を文字列化
  const embedTexts = formatEmbedsToTexts(embeds);
  const userMessage = buildUserMessage(content, embedTexts, originalUrl);

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

  // 画像があるかどうかでプロンプトを切り替え
  const hasImages = images.length > 0;
  const fullPrompt = `${buildExtractionPrompt(currentDate, hasImages)}

---

${userMessage}`;

  logger.info("イベント情報の抽出を開始します", {
    url: originalUrl,
    contentLength: content.length,
    embedCount: embeds.length,
    imageCount: images.length,
    userMessage,
  });

  // LLM API を呼び出し（JSONパースエラー時はリトライ）
  let parsed: ParsedEventInfo | undefined;
  let lastError = "";

  for (let attempt = 0; attempt <= JSON_PARSE_RETRY_CONFIG.maxRetries; attempt++) {
    const apiResult = await callLlmApi(
      getProviderChain(),
      fullPrompt,
      hasImages ? images : undefined,
    );
    if (!apiResult.success) {
      logger.error("LLM API 呼び出しに失敗しました", {
        url: originalUrl,
        reason: apiResult.reason,
      });
      return apiResult;
    }

    // JSONをパース
    const parseResult = parseEventJson(apiResult.data);
    if (parseResult.success) {
      parsed = parseResult.data;
      if (attempt > 0) {
        logger.info("JSONパースリトライ成功", { attempt: attempt + 1 });
      }
      break;
    }

    // パースエラー時はリトライ
    lastError = parseResult.reason;
    if (attempt < JSON_PARSE_RETRY_CONFIG.maxRetries) {
      logger.warn("JSONパースエラー。リトライします", {
        attempt: attempt + 1,
        maxRetries: JSON_PARSE_RETRY_CONFIG.maxRetries + 1,
        error: lastError,
      });
      await sleep(JSON_PARSE_RETRY_CONFIG.delayMs);
    }
  }

  if (parsed === undefined) {
    return {
      success: false,
      reason: lastError,
    };
  }

  return buildEventInfoFromParsed(parsed, originalUrl, "イベント情報を抽出しました");
}

/**
 * JSON文字列内の不正なエスケープシーケンスを修正する
 * Gemini APIが \* \. \+ \( \) \- などの正規表現エスケープを出力することがある
 * 有効なJSONエスケープ: \", \\, \/, \b, \f, \n, \r, \t, \uXXXX
 * 上記以外の \X パターンを X に変換（バックスラッシュを除去）
 */
function fixInvalidJsonEscapes(jsonString: string): string {
  return jsonString.replace(/\\([^"\\/bfnrtu])/g, "$1");
}

/**
 * JSON文字列をパースしてイベント情報を取得する
 */
export function parseEventJson(jsonString: string): Result<ParsedEventInfo> {
  try {
    // JSONブロックを抽出（```json ... ``` 形式の場合に対応）
    const cleanJson = (() => {
      const trimmed = jsonString.trim();

      // パターン1: 完全な ```json ... ``` 形式
      const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch !== null && codeBlockMatch[1] !== undefined) {
        return codeBlockMatch[1].trim();
      }

      // パターン2: 開始の ```json はあるが閉じの ``` がない場合
      const openCodeBlockMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*)$/);
      if (openCodeBlockMatch !== null && openCodeBlockMatch[1] !== undefined) {
        return openCodeBlockMatch[1].trim();
      }

      return trimmed;
    })();

    // 不正なエスケープシーケンスを修正してからパース
    const fixedJson = fixInvalidJsonEscapes(cleanJson);
    const parsed: unknown = JSON.parse(fixedJson);

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
export function isValidParsedEventInfo(value: unknown): value is ParsedEventInfo {
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

/**
 * ParsedEventInfo から EventInfo を構築する
 * @param parsed パース済みイベント情報
 * @param originalUrl 元のURL
 * @param logMessage ログに出力するメッセージ
 * @returns EventInfo または失敗結果
 */
export function buildEventInfoFromParsed(
  parsed: ParsedEventInfo,
  originalUrl: string,
  logMessage: string
): Result<EventInfo> {
  // イベント情報でない場合はスキップ
  if (!parsed.isEvent) {
    logger.info("イベント情報ではないためスキップします", { url: originalUrl });
    return {
      success: false,
      reason: NOT_EVENT_REASON,
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

  logger.info(logMessage, {
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
 * 修正用のプロンプトを生成する
 * @param originalPrompt 元のプロンプト
 * @param correction ユーザーからの修正指示
 * @returns 修正用プロンプト
 */
export function buildCorrectionPrompt(
  originalPrompt: string,
  correction: string
): string {
  return `${originalPrompt}

---

**ユーザーからの修正指示:**
${correction}

上記の修正指示を考慮して、イベント情報を再度抽出してください。`;
}

/**
 * 入力情報を整形してユーザーメッセージを生成する
 * @param content メッセージ本文
 * @param embedTexts 整形済み embed テキストの配列
 * @param originalUrl 元のURL
 * @returns 整形されたユーザーメッセージ
 */
export function buildUserMessage(
  content: string,
  embedTexts: string[],
  originalUrl: string
): string {
  return `**Discordメッセージ本文:**
${content}

**埋め込み情報（embed）:**
${embedTexts.length > 0 ? embedTexts.join("\n\n---\n\n") : "（なし）"}

**元のURL:** ${originalUrl}`;
}

/**
 * Embed を文字列形式に変換する
 * Discord.js の Embed と SerializedEmbed の両方に対応
 * @param embeds EmbedLike の配列
 * @returns 文字列形式の embed 情報の配列
 */
export function formatEmbedsToTexts(embeds: readonly EmbedLike[]): string[] {
  return embeds
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
}

/**
 * 修正指示を含めてイベント情報を再抽出する
 * @param content 元のメッセージ本文
 * @param embeds シリアライズ済み embed 情報
 * @param originalUrl 元のURL
 * @param correction ユーザーからの修正指示
 * @returns 再抽出されたイベント情報
 */
export async function reExtractEventWithCorrection(
  content: string,
  embeds: Array<{
    title: string | null;
    description: string | null;
    url: string | null;
    author: { name: string } | null;
    fields: Array<{ name: string; value: string }>;
    image: { url: string } | null;
    thumbnail: { url: string } | null;
  }>,
  originalUrl: string,
  correction: string
): Promise<Result<EventInfo>> {
  // embed から画像URLを抽出
  const imageUrls = extractImageUrls(embeds);

  // 画像を取得してBase64エンコード
  const images = await fetchMultipleImages(imageUrls);

  // embed 情報を文字列化
  const embedTexts = formatEmbedsToTexts(embeds);
  const userMessage = buildUserMessage(content, embedTexts, originalUrl);

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

  // 画像があるかどうかでプロンプトを切り替え
  const hasImages = images.length > 0;
  const basePrompt = buildExtractionPrompt(currentDate, hasImages);
  const fullPrompt = buildCorrectionPrompt(
    `${basePrompt}

---

${userMessage}`,
    correction
  );

  logger.info("修正指示を含めてイベント情報を再抽出します", {
    url: originalUrl,
    correction,
  });

  // LLM API を呼び出し（JSONパースエラー時はリトライ）
  let parsed: ParsedEventInfo | undefined;
  let lastError = "";

  for (let attempt = 0; attempt <= JSON_PARSE_RETRY_CONFIG.maxRetries; attempt++) {
    const apiResult = await callLlmApi(
      getProviderChain(),
      fullPrompt,
      hasImages ? images : undefined,
    );
    if (!apiResult.success) {
      logger.error("LLM API 呼び出しに失敗しました", {
        url: originalUrl,
        reason: apiResult.reason,
      });
      return apiResult;
    }

    // JSONをパース
    const parseResult = parseEventJson(apiResult.data);
    if (parseResult.success) {
      parsed = parseResult.data;
      if (attempt > 0) {
        logger.info("JSONパースリトライ成功", { attempt: attempt + 1 });
      }
      break;
    }

    // パースエラー時はリトライ
    lastError = parseResult.reason;
    if (attempt < JSON_PARSE_RETRY_CONFIG.maxRetries) {
      logger.warn("JSONパースエラー。リトライします", {
        attempt: attempt + 1,
        maxRetries: JSON_PARSE_RETRY_CONFIG.maxRetries + 1,
        error: lastError,
      });
      await sleep(JSON_PARSE_RETRY_CONFIG.delayMs);
    }
  }

  if (parsed === undefined) {
    return {
      success: false,
      reason: lastError,
    };
  }

  return buildEventInfoFromParsed(parsed, originalUrl, "修正されたイベント情報を抽出しました");
}
