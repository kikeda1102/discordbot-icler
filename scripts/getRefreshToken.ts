/**
 * Google OAuth2 リフレッシュトークン取得スクリプト
 *
 * 使い方:
 * 1. .env に GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定
 * 2. pnpm tsx scripts/getRefreshToken.ts を実行
 * 3. 表示されたURLをブラウザで開き、Googleアカウントで認証
 * 4. リダイレクト先のURLから code パラメータをコピー
 * 5. ターミナルに戻り、コードを入力
 * 6. 表示されたリフレッシュトークンを .env の GOOGLE_REFRESH_TOKEN に設定
 */

import { google } from 'googleapis';
import * as readline from 'readline';

const CLIENT_ID = process.env['GOOGLE_CLIENT_ID'];
const CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('エラー: GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  'http://localhost:3000/oauth2callback' // リダイレクトURI
);

// 認証URLを生成
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar.events'],
  prompt: 'consent', // 毎回リフレッシュトークンを取得するため
});

console.log('以下のURLをブラウザで開いてください:');
console.log('');
console.log(authUrl);
console.log('');
console.log('認証後、リダイレクト先のURLから "code" パラメータの値をコピーしてください。');
console.log('（URLが http://localhost:3000/oauth2callback?code=XXXX&scope=... の場合、XXXX の部分）');
console.log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('認証コードを入力してください: ', async (code) => {
  rl.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);

    console.log('');
    console.log('=== トークン取得成功 ===');
    console.log('');

    if (tokens.refresh_token) {
      console.log('リフレッシュトークン:');
      console.log(tokens.refresh_token);
      console.log('');
      console.log('このトークンを .env の GOOGLE_REFRESH_TOKEN に設定してください。');
    } else {
      console.log('警告: リフレッシュトークンが取得できませんでした。');
      console.log('Google Cloud Console で OAuth 同意画面の設定を確認してください。');
    }
  } catch (error) {
    console.error('エラー: トークンの取得に失敗しました');
    if (error instanceof Error) {
      console.error(error.message);
    }
  }
});
