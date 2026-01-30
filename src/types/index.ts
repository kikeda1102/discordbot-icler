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
    channelId: string;
  };
  google: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId: string;
  };
  anthropic: {
    apiKey: string;
  };
  twitter: {
    bearerToken: string;
  };
  app: {
    logLevel: LogLevel;
    nodeEnv: string;
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
}

/** ツイート情報 */
export interface TweetInfo {
  id: string;
  text: string;
  authorUsername: string;
  createdAt: Date;
}
