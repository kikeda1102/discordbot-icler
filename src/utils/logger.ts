/**
 * ロギングユーティリティ
 */

import type { LogLevel } from '../types/index.js';
import { getConfig } from '../config/index.js';

/** ログレベルの優先度 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** ログのコンテキスト情報 */
type LogContext = Record<string, unknown>;

/** タイムスタンプを取得 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/** ログを出力すべきか判定 */
function shouldLog(level: LogLevel, configLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[configLevel];
}

/** ログメッセージをフォーマット */
function formatLogMessage(
  level: LogLevel,
  message: string,
  context?: LogContext
): string {
  const timestamp = getTimestamp();
  const levelUpperCase = level.toUpperCase().padEnd(5);
  const baseMessage = `[${timestamp}] ${levelUpperCase} ${message}`;

  if (context !== undefined && Object.keys(context).length > 0) {
    return `${baseMessage} ${JSON.stringify(context)}`;
  }

  return baseMessage;
}

/** ロガーを作成 */
function createLogger() {
  let configLogLevel: LogLevel | null = null;

  /** 設定からログレベルを取得（遅延評価） */
  function getLogLevel(): LogLevel {
    if (configLogLevel === null) {
      try {
        configLogLevel = getConfig().app.logLevel;
      } catch {
        // 設定読み込み前はデフォルトでinfo
        return 'info';
      }
    }
    return configLogLevel;
  }

  return {
    debug(message: string, context?: LogContext): void {
      if (shouldLog('debug', getLogLevel())) {
        console.debug(formatLogMessage('debug', message, context));
      }
    },

    info(message: string, context?: LogContext): void {
      if (shouldLog('info', getLogLevel())) {
        console.info(formatLogMessage('info', message, context));
      }
    },

    warn(message: string, context?: LogContext): void {
      if (shouldLog('warn', getLogLevel())) {
        console.warn(formatLogMessage('warn', message, context));
      }
    },

    error(message: string, context?: LogContext): void {
      if (shouldLog('error', getLogLevel())) {
        console.error(formatLogMessage('error', message, context));
      }
    },
  };
}

/** ロガーインスタンス */
export const logger = createLogger();
