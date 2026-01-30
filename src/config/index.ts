/**
 * 環境変数の型安全なアクセスを提供する設定モジュール
 */

import type { Config, LogLevel } from '../types/index.js';

/** 環境変数取得のヘルパー関数 */
function getEnvVar(key: string): string | undefined {
  return process.env[key];
}

/** 必須環境変数を取得（未設定の場合はエラー） */
function getRequiredEnvVar(key: string): string {
  const value = getEnvVar(key);
  if (value === undefined || value === '') {
    throw new Error(`環境変数 ${key} が設定されていません`);
  }
  return value;
}

/** ログレベルの型ガード */
function isLogLevel(value: string): value is LogLevel {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

/** ログレベルのバリデーション */
function parseLogLevel(value: string | undefined): LogLevel {
  if (value !== undefined && isLogLevel(value)) {
    return value;
  }
  return 'info';
}

/** 設定を読み込み・バリデーション */
function loadConfig(): Config {
  return {
    discord: {
      botToken: getRequiredEnvVar('DISCORD_BOT_TOKEN'),
      channelId: getRequiredEnvVar('DISCORD_CHANNEL_ID'),
    },
    google: {
      clientId: getRequiredEnvVar('GOOGLE_CLIENT_ID'),
      clientSecret: getRequiredEnvVar('GOOGLE_CLIENT_SECRET'),
      refreshToken: getRequiredEnvVar('GOOGLE_REFRESH_TOKEN'),
      calendarId: getRequiredEnvVar('GOOGLE_CALENDAR_ID'),
    },
    gemini: {
      apiKey: getRequiredEnvVar('GEMINI_API_KEY'),
    },
    app: {
      logLevel: parseLogLevel(getEnvVar('LOG_LEVEL')),
      nodeEnv: getEnvVar('NODE_ENV') ?? 'development',
    },
  };
}

/** 設定のシングルトンインスタンス */
let configInstance: Config | null = null;

/** 設定を取得（遅延初期化） */
export function getConfig(): Config {
  if (configInstance === null) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/** 設定をリセット（テスト用） */
export function resetConfig(): void {
  configInstance = null;
}
