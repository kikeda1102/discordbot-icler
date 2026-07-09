import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ButtonInteraction, Client, Interaction } from "discord.js";

vi.mock("../src/stores/pendingEvents.js", () => ({
  getPendingEvent: vi.fn(),
  removePendingEvent: vi.fn(),
  isEventExpired: vi.fn(() => false),
  updatePendingEvent: vi.fn(),
}));

vi.mock("../src/stores/processedMessages.js", () => ({
  unmarkProcessed: vi.fn(),
}));

vi.mock("../src/services/calendarService.js", () => ({
  createCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  findSimilarEvents: vi.fn(() => Promise.resolve([])),
}));

vi.mock("../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/utils/survey.js", () => ({
  buildSurveySuffix: vi.fn(() => ""),
}));

import { registerInteractionHandler } from "../src/handlers/interactionCreate.js";
import { getPendingEvent } from "../src/stores/pendingEvents.js";
import { unmarkProcessed } from "../src/stores/processedMessages.js";
import type { PendingEvent } from "../src/types/index.js";

type InteractionHandler = (interaction: Interaction) => void;

const BOT_USER_ID = "bot-user-id";
const OWNER_USER_ID = "owner-123";
const OTHER_USER_ID = "other-456";
const ORIGINAL_MESSAGE_ID = "original-msg-1";

const createPendingEvent = (): PendingEvent => ({
  eventInfo: {
    title: "テストイベント",
    description: "説明",
    startTime: new Date("2026-07-12T16:00:00+09:00"),
    endTime: new Date("2026-07-12T22:00:00+09:00"),
    url: "https://x.com/test/status/123",
    isAllDay: false,
  },
  userId: OWNER_USER_ID,
  originalMessageId: ORIGINAL_MESSAGE_ID,
  createdAt: Date.now(),
  confirmationMessageId: "confirm-msg-1",
  channelId: "channel-1",
  originalContent: "テスト投稿",
  originalEmbeds: [],
  originalUrl: "https://x.com/test/status/123",
});

const createMockButtonInteraction = (
  customId: string,
  userId: string,
): ButtonInteraction =>
  ({
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    user: { id: userId },
    reply: vi.fn(() => Promise.resolve()),
    message: {
      delete: vi.fn(() => Promise.resolve()),
    },
  }) as unknown as ButtonInteraction;

const setupHandler = (): InteractionHandler => {
  const handlers: InteractionHandler[] = [];

  const mockClient = {
    user: { id: BOT_USER_ID },
    on: vi.fn((event: string, handler: InteractionHandler) => {
      if (event === "interactionCreate") {
        handlers.push(handler);
      }
    }),
  } as unknown as Client;

  registerInteractionHandler(mockClient);

  const handler = handlers[0];
  if (handler === undefined) {
    throw new Error("Handler was not registered");
  }
  return handler;
};

describe("interactionCreate キャンセル時の unmarkProcessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("event_cancel_ クリックで unmarkProcessed が originalMessageId で呼ばれる", async () => {
    const pending = createPendingEvent();
    vi.mocked(getPendingEvent).mockReturnValue(pending);

    const handler = setupHandler();
    const interaction = createMockButtonInteraction(
      "event_cancel_evt-1",
      OWNER_USER_ID,
    );

    await handler(interaction);

    expect(unmarkProcessed).toHaveBeenCalledWith(ORIGINAL_MESSAGE_ID);
  });

  it("event_force_cancel_ クリックでも unmarkProcessed が呼ばれる", async () => {
    const pending = createPendingEvent();
    vi.mocked(getPendingEvent).mockReturnValue(pending);

    const handler = setupHandler();
    const interaction = createMockButtonInteraction(
      "event_force_cancel_evt-1",
      OWNER_USER_ID,
    );

    await handler(interaction);

    expect(unmarkProcessed).toHaveBeenCalledWith(ORIGINAL_MESSAGE_ID);
  });

  it("投稿者以外のクリックでは unmarkProcessed が呼ばれない", async () => {
    const pending = createPendingEvent();
    vi.mocked(getPendingEvent).mockReturnValue(pending);

    const handler = setupHandler();
    const interaction = createMockButtonInteraction(
      "event_cancel_evt-1",
      OTHER_USER_ID,
    );

    await handler(interaction);

    expect(unmarkProcessed).not.toHaveBeenCalled();
  });

  it("pending が見つからない場合は unmarkProcessed が呼ばれない", async () => {
    vi.mocked(getPendingEvent).mockReturnValue(undefined);

    const handler = setupHandler();
    const interaction = createMockButtonInteraction(
      "event_cancel_evt-1",
      OWNER_USER_ID,
    );

    await handler(interaction);

    expect(unmarkProcessed).not.toHaveBeenCalled();
  });
});
