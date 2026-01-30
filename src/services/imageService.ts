/**
 * 画像取得サービス
 * URLから画像をダウンロードしてBase64エンコードする
 */

import type { ImageData, Result } from "../types/index.js";
import { logger } from "../utils/logger.js";

/** サポートするMIMEタイプ */
const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

/** 画像サイズ上限（4MB） */
const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;

/** タイムアウト（10秒） */
const FETCH_TIMEOUT_MS = 10000;

/**
 * MIMEタイプがサポートされているか確認
 */
function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.some((supported) =>
    mimeType.startsWith(supported),
  );
}

/**
 * URLから画像をダウンロードしてBase64エンコードする
 * @param url 画像URL
 * @returns Base64エンコードされた画像データ
 */
export async function fetchImageAsBase64(url: string): Promise<Result<ImageData>> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // 一般的なブラウザのUser-Agentを設定（一部CDNでブロックされる場合があるため）
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        reason: `画像の取得に失敗しました: ${response.status} ${response.statusText}`,
      };
    }

    // Content-Typeを確認
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!isSupportedMimeType(contentType)) {
      return {
        success: false,
        reason: `サポートされていない画像形式です: ${contentType}`,
      };
    }

    // Content-Lengthを確認（存在する場合）
    const contentLength = response.headers.get("Content-Length");
    if (contentLength !== null) {
      const size = parseInt(contentLength, 10);
      if (size > MAX_IMAGE_SIZE_BYTES) {
        return {
          success: false,
          reason: `画像サイズが上限（4MB）を超えています: ${Math.round(size / 1024 / 1024)}MB`,
        };
      }
    }

    // 画像データを取得
    const arrayBuffer = await response.arrayBuffer();

    // サイズチェック（Content-Lengthがない場合のフォールバック）
    if (arrayBuffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      return {
        success: false,
        reason: `画像サイズが上限（4MB）を超えています: ${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB`,
      };
    }

    // Base64エンコード
    const base64Data = Buffer.from(arrayBuffer).toString("base64");

    // MIMEタイプを正規化（charset等を除去）
    const mimeType = contentType.split(";")[0]?.trim() ?? "image/jpeg";

    logger.debug("画像を取得しました", {
      url,
      mimeType,
      sizeKB: Math.round(arrayBuffer.byteLength / 1024),
    });

    return {
      success: true,
      data: {
        mimeType,
        base64Data,
      },
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        reason: `画像の取得がタイムアウトしました: ${url}`,
      };
    }

    const errorMessage =
      error instanceof Error ? error.message : "不明なエラー";
    return {
      success: false,
      reason: `画像の取得中にエラーが発生しました: ${errorMessage}`,
    };
  }
}

/**
 * 複数の画像URLからBase64エンコードされた画像データを取得する
 * 失敗した画像はスキップし、成功したものだけを返す
 * @param urls 画像URLの配列
 * @returns 取得に成功した画像データの配列
 */
export async function fetchMultipleImages(urls: string[]): Promise<ImageData[]> {
  if (urls.length === 0) {
    return [];
  }

  const results = await Promise.all(
    urls.map(async (url) => {
      const result = await fetchImageAsBase64(url);
      if (!result.success) {
        logger.warn("画像の取得に失敗しました（スキップ）", {
          url,
          reason: result.reason,
        });
        return null;
      }
      return result.data;
    }),
  );

  // 成功した画像のみをフィルタリング
  return results.filter((data): data is ImageData => data !== null);
}
