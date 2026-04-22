/**
 * アンケート URL 関連のユーティリティ
 */

import { getConfig } from '../config/index.js';

/**
 * アンケート URL を確率で抽選する。
 * URL 未設定、または抽選に外れた場合は undefined を返す。
 */
export function pickSurveyUrl(): string | undefined {
  const { surveyUrl, surveyRate } = getConfig().app;
  if (surveyUrl === undefined) {
    return undefined;
  }
  if (Math.random() >= surveyRate) {
    return undefined;
  }
  return surveyUrl;
}

/**
 * 操作完了メッセージの末尾に追記するアンケート案内。
 * 抽選に外れた場合は空文字列を返すため、テンプレートリテラルにそのまま埋め込める。
 */
export function buildSurveySuffix(): string {
  const url = pickSurveyUrl();
  if (url === undefined) {
    return '';
  }
  return `\n\n📊 アンケートにご協力をお願いします！\n${url}`;
}
