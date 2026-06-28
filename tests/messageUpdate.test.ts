import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client, Message, PartialMessage } from 'discord.js';

vi.mock('../src/stores/processedMessages.js', () => ({
  isProcessed: vi.fn(() => false),
  markProcessed: vi.fn(),
}));

vi.mock('../src/stores/awaitingEmbeds.js', () => ({
  consumeAwaiting: vi.fn(),
}));

vi.mock('../src/handlers/messageCreate.js', () => ({
  processEventExtraction: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { registerMessageUpdateHandler } from '../src/handlers/messageUpdate.js';
import { isProcessed } from '../src/stores/processedMessages.js';
import { processEventExtraction } from '../src/handlers/messageCreate.js';

const MONITORED_CHANNEL = 'channel-123';
const BOT_USER_ID = 'bot-user-id';

type MessageUpdateHandler = (
  oldMessage: Message | PartialMessage,
  newMessage: Message | PartialMessage,
) => void;

const createMockMessage = (
  overrides: Partial<{
    channelId: string;
    system: boolean;
    authorId: string;
    authorBot: boolean;
    content: string;
    embedCount: number;
    id: string;
    partial: boolean;
  }> = {},
): Message => {
  const embedCount = overrides.embedCount ?? 1;
  return {
    id: overrides.id ?? 'msg-1',
    channelId: overrides.channelId ?? MONITORED_CHANNEL,
    system: overrides.system ?? false,
    partial: overrides.partial ?? false,
    content:
      overrides.content ?? 'https://x.com/test/status/123456789',
    author: {
      id: overrides.authorId ?? 'human-user',
      bot: overrides.authorBot ?? false,
    },
    embeds: Array.from({ length: embedCount }, () => ({
      title: 'Test',
      description: 'Test embed',
    })),
    fetch: vi.fn(),
  } as unknown as Message;
};

const createMockPartialMessage = (): PartialMessage =>
  ({
    id: 'old-msg',
    channelId: MONITORED_CHANNEL,
    partial: true,
  }) as unknown as PartialMessage;

/**
 * mock client を作り、registerMessageUpdateHandler を呼んで
 * 登録されたハンドラを返す
 */
const setupHandler = (): MessageUpdateHandler => {
  let capturedHandler: MessageUpdateHandler | undefined;

  const mockClient = {
    user: { id: BOT_USER_ID },
    on: vi.fn(
      (
        event: string,
        handler: MessageUpdateHandler,
      ) => {
        if (event === 'messageUpdate') {
          capturedHandler = handler;
        }
      },
    ),
  } as unknown as Client;

  registerMessageUpdateHandler(mockClient, [MONITORED_CHANNEL]);

  if (capturedHandler === undefined) {
    throw new Error('Handler was not registered');
  }

  return capturedHandler;
};

describe('messageUpdate ハンドラ', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('監視チャンネル外のメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ channelId: 'other-channel' });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('システムメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ system: true });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('Bot 自身のメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ authorId: BOT_USER_ID });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('他の Bot のメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ authorBot: true });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('embed がないメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ embedCount: 0 });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('X URL を含まないメッセージは無視する', async () => {
    const handler = setupHandler();
    const message = createMockMessage({ content: 'ただのメッセージ' });

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('処理済みメッセージは無視する', async () => {
    vi.mocked(isProcessed).mockReturnValueOnce(true);

    const handler = setupHandler();
    const message = createMockMessage();

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).not.toHaveBeenCalled();
  });

  it('条件を満たすメッセージで processEventExtraction が呼ばれる', async () => {
    const handler = setupHandler();
    const message = createMockMessage();

    await handler(createMockPartialMessage(), message);

    expect(processEventExtraction).toHaveBeenCalledWith(
      message,
      message.content,
      message.embeds,
      'https://x.com/test/status/123456789',
    );
  });

  it('partial メッセージは fetch して完全取得する', async () => {
    const handler = setupHandler();
    const fullMessage = createMockMessage();
    const partialNew = {
      ...createMockMessage({ partial: true }),
      partial: true,
      fetch: vi.fn(() => Promise.resolve(fullMessage)),
    } as unknown as PartialMessage;

    await handler(createMockPartialMessage(), partialNew);

    expect(partialNew.fetch).toHaveBeenCalled();
    expect(processEventExtraction).toHaveBeenCalled();
  });
});
