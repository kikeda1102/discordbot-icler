import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  markProcessed,
  isProcessed,
  cleanupProcessedMessages,
} from '../src/stores/processedMessages.js';

// テストごとにモジュールを再読み込みして状態をリセット
beforeEach(async () => {
  vi.resetModules();
});

describe('markProcessed / isProcessed', () => {
  it('マークしたメッセージは処理済みになる', async () => {
    const { markProcessed, isProcessed } = await import(
      '../src/stores/processedMessages.js'
    );

    markProcessed('msg-1');

    expect(isProcessed('msg-1')).toBe(true);
  });

  it('マークしていないメッセージは未処理', async () => {
    const { isProcessed } = await import(
      '../src/stores/processedMessages.js'
    );

    expect(isProcessed('msg-unknown')).toBe(false);
  });

  it('複数のメッセージを独立に管理できる', async () => {
    const { markProcessed, isProcessed } = await import(
      '../src/stores/processedMessages.js'
    );

    markProcessed('msg-a');
    markProcessed('msg-b');

    expect(isProcessed('msg-a')).toBe(true);
    expect(isProcessed('msg-b')).toBe(true);
    expect(isProcessed('msg-c')).toBe(false);
  });
});

describe('cleanupProcessedMessages', () => {
  it('古いエントリを削除する', async () => {
    const { markProcessed, isProcessed, cleanupProcessedMessages } =
      await import('../src/stores/processedMessages.js');

    markProcessed('msg-old');

    // 11分後に進める
    vi.useFakeTimers();
    vi.advanceTimersByTime(11 * 60 * 1000);

    cleanupProcessedMessages();

    expect(isProcessed('msg-old')).toBe(false);

    vi.useRealTimers();
  });

  it('新しいエントリは残る', async () => {
    const { markProcessed, isProcessed, cleanupProcessedMessages } =
      await import('../src/stores/processedMessages.js');

    markProcessed('msg-new');

    // 5分後（10分未満）に進める
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000);

    cleanupProcessedMessages();

    expect(isProcessed('msg-new')).toBe(true);

    vi.useRealTimers();
  });
});
