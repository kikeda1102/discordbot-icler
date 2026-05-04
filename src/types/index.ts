/**
 * 型定義
 */

/** ログレベル */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Result型: 成功 */
export interface Success<T> {
  success: true;
  data: T;
}

/** Result型: 失敗 */
export interface Failure {
  success: false;
  reason: string;
}

/** Result型パターン */
export type Result<T> = Success<T> | Failure;

/** 環境変数の設定 */
export interface Config {
  discord: {
    botToken: string;
    channelIds: string[];
  };
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId: string;
  };
  gemini: {
    apiKey: string;
  };
  app: {
    logLevel: LogLevel;
    nodeEnv: string;
    surveyUrl: string | undefined;
    surveyRate: number;
  };
}

/** イベント情報 */
export interface EventInfo {
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  url?: string;
  isAllDay?: boolean;
}

/** 画像データ（Base64エンコード済み） */
export interface ImageData {
  mimeType: string;
  base64Data: string;
}

/** Discord Embed のシリアライズ可能な形式 */
export interface SerializedEmbed {
  title: string | null;
  description: string | null;
  url: string | null;
  author: { name: string } | null;
  fields: Array<{ name: string; value: string }>;
  image: { url: string } | null;
  thumbnail: { url: string } | null;
}

/** Embed のテキスト変換に必要な最小プロパティ */
export interface EmbedLike {
  title: string | null;
  description: string | null;
  author?: { name: string } | null;
  fields: ReadonlyArray<{ name: string; value: string }>;
}

/** Embed の画像URL抽出に必要な最小プロパティ */
export interface EmbedWithImage {
  image?: { url: string } | null;
  thumbnail?: { url: string } | null;
}

/** 類似イベント情報（重複チェック用） */
export interface SimilarEvent {
  id: string;
  title: string;
  startTime: string;
  location?: string;
}

/** パースしたイベント情報（Gemini API レスポンス用） */
export interface ParsedEventInfo {
  isEvent: boolean;
  hasTime: boolean;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
}

/** 確認待ちのイベント情報 */
export interface PendingEvent {
  /** 抽出されたイベント情報 */
  eventInfo: EventInfo;
  /** 元の投稿者のユーザーID（承認者制限用） */
  userId: string;
  /** 作成日時のタイムスタンプ（タイムアウト用） */
  createdAt: number;
  /** 確認メッセージのID */
  confirmationMessageId: string;
  /** 確認メッセージが送信されたチャンネルのID */
  channelId: string;
  /** 元のメッセージ本文（再抽出用） */
  originalContent: string;
  /** 元のembed情報（再抽出用） */
  originalEmbeds: SerializedEmbed[];
  /** 元のURL */
  originalUrl: string;
  /** 上書き対象のカレンダーイベントID */
  overwriteTargetCalendarEventId?: string;
  /** 検出された類似イベント一覧 */
  similarEvents?: SimilarEvent[];
}

