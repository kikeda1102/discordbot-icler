import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Client, Message } from "discord.js";

vi.mock("../src/stores/processedMessages.js", () => ({
  isProcessed: vi.fn(() => false),
  markProcessed: vi.fn(),
  unmarkProcessed: vi.fn(),
}));

vi.mock("../src/stores/awaitingEmbeds.js", () => ({
  isAwaiting: vi.fn(() => false),
  registerAwaiting: vi.fn(),
  removeAwaiting: vi.fn(),
}));

vi.mock("../src/stores/pendingEvents.js", () => ({
  generateEventId: vi.fn(() => "event-1"),
  addPendingEvent: vi.fn(),
  getEventIdByMessageId: vi.fn(() => undefined),
  getPendingEvent: vi.fn(() => undefined),
  updatePendingEvent: vi.fn(),
}));

vi.mock("../src/services/eventExtractor.js", () => ({
  extractEventFromMessage: vi.fn(),
  reExtractEventWithCorrection: vi.fn(),
  NOT_EVENT_REASON: "イベント情報が含まれていません",
  PAST_EVENT_REASON: "イベントの開始日時が過去のため無視します",
}));

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  registerMessageHandler,
  shouldUnmarkProcessed,
} from "../src/handlers/messageCreate.js";
import {
  markProcessed,
  unmarkProcessed,
} from "../src/stores/processedMessages.js";
import { extractEventFromMessage } from "../src/services/eventExtractor.js";

const MONITORED_CHANNEL = "channel-123";
const BOT_USER_ID = "bot-user-id";
const URL_1 = "https://x.com/test/status/111";
const URL_2 = "https://x.com/test/status/222";

const NOT_EVENT_RESULT = {
  success: false as const,
  reason: "イベント情報が含まれていません",
};

const FAILURE_RESULT = {
  success: false as const,
  reason: "Gemini API エラー: 503 overloaded",
};

const SUCCESS_RESULT = {
  success: true as const,
  data: {
    title: "テストイベント",
    description: "説明",
    startTime: new Date("2026-07-12T16:00:00+09:00"),
    endTime: new Date("2026-07-12T22:00:00+09:00"),
    url: URL_1,
    isAllDay: false,
  },
};

type MessageHandler = (message: Message) => void;

/** embed 付きメッセージのモックを作る */
const createMockMessage = (content: string): Message => {
  const confirmationMessage = {
    id: "confirmation-1",
    edit: vi.fn(() => Promise.resolve()),
  };
  return {
    id: "msg-1",
    channelId: MONITORED_CHANNEL,
    system: false,
    content,
    reference: null,
    author: { id: "human-user", bot: false },
    embeds: [
      {
        title: "Test",
        description: "Test embed",
        url: null,
        author: null,
        fields: [],
        image: null,
        thumbnail: null,
      },
    ],
    reply: vi.fn(() => Promise.resolve(confirmationMessage)),
  } as unknown as Message;
};

/** registerMessageHandler で登録されたハンドラを捕捉して返す */
const setupHandler = (): MessageHandler => {
  const handlers: MessageHandler[] = [];

  const mockClient = {
    user: { id: BOT_USER_ID },
    on: vi.fn((event: string, handler: MessageHandler) => {
      if (event === "messageCreate") {
        handlers.push(handler);
      }
    }),
  } as unknown as Client;

  registerMessageHandler(mockClient, [MONITORED_CHANNEL]);

  const handler = handlers[0];
  if (handler === undefined) {
    throw new Error("Handler was not registered");
  }
  return handler;
};

/** 登録ハンドラは promise を返さないため、非同期処理の完了をタイマーで待つ */
const flushAsync = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("shouldUnmarkProcessed", () => {
  it("全て failure なら true", () => {
    expect(shouldUnmarkProcessed(["failure", "failure"])).toBe(true);
  });

  it("success を含むなら false", () => {
    expect(shouldUnmarkProcessed(["success", "failure"])).toBe(false);
  });

  it("全て notEvent なら false", () => {
    expect(shouldUnmarkProcessed(["notEvent", "notEvent"])).toBe(false);
  });

  it("notEvent と failure の混在は true", () => {
    expect(shouldUnmarkProcessed(["notEvent", "failure"])).toBe(true);
  });

  it("空配列は false", () => {
    expect(shouldUnmarkProcessed([])).toBe(false);
  });
});

describe("messageCreate ハンドラ（embed 即時処理パス）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("全 URL が一時的失敗なら unmarkProcessed が呼ばれる", async () => {
    vi.mocked(extractEventFromMessage).mockResolvedValue(FAILURE_RESULT);

    const handler = setupHandler();
    handler(createMockMessage(`${URL_1} ${URL_2}`));
    await flushAsync();

    expect(markProcessed).toHaveBeenCalledWith("msg-1");
    expect(unmarkProcessed).toHaveBeenCalledWith("msg-1");
  });

  it("一部 URL が成功したら unmarkProcessed は呼ばれない", async () => {
    vi.mocked(extractEventFromMessage)
      .mockResolvedValueOnce(SUCCESS_RESULT)
      .mockResolvedValueOnce(FAILURE_RESULT);

    const handler = setupHandler();
    handler(createMockMessage(`${URL_1} ${URL_2}`));
    await flushAsync();

    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  it("全 URL が非イベント判定なら unmarkProcessed は呼ばれない", async () => {
    vi.mocked(extractEventFromMessage).mockResolvedValue(NOT_EVENT_RESULT);

    const handler = setupHandler();
    handler(createMockMessage(`${URL_1} ${URL_2}`));
    await flushAsync();

    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  it("markProcessed は抽出処理より先に呼ばれる", async () => {
    vi.mocked(extractEventFromMessage).mockResolvedValue(FAILURE_RESULT);

    const handler = setupHandler();
    handler(createMockMessage(URL_1));
    await flushAsync();

    const markOrder = vi.mocked(markProcessed).mock.invocationCallOrder[0];
    const extractOrder = vi.mocked(extractEventFromMessage).mock
      .invocationCallOrder[0];
    expect(markOrder).toBeDefined();
    expect(extractOrder).toBeDefined();
    if (markOrder !== undefined && extractOrder !== undefined) {
      expect(markOrder).toBeLessThan(extractOrder);
    }
  });
});
