import { describe, it, expect, vi, beforeEach } from "vitest";

const { postSpy, umamiLogSpy } = vi.hoisted(() => ({
  postSpy: vi.fn(() => Promise.resolve({ data: {} })),
  umamiLogSpy: vi.fn()
}));

vi.mock("axios", () => ({
  default: {
    post: postSpy,
    // Pulled in transitively by the entities barrel debugLogger imports.
    create: () => ({ get: vi.fn(), post: vi.fn() }),
    isAxiosError: () => false
  },
  isAxiosError: () => false
}));
vi.mock("../utils/umami.ts", () => ({ default: { log: umamiLogSpy } }));
vi.mock("node:os", () => ({ default: { hostname: () => "c0ffee1nstance" } }));

process.env.DEBUG_CHAT_ID = "debug-chat-id";
process.env.TELEGRAM_DEBUG_BOT_TOKEN = "debug-bot-token";

const { logError, logErrorForApps, logWarningForApps } =
  await import("../utils/debugLogger.ts");

const sentTexts = () =>
  postSpy.mock.calls.map(
    (call) => (call as unknown as [string, { text: string }])[1].text
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logError", () => {
  it("does not repeat the error header already present in the stack", async () => {
    const error = new Error("boom");
    await logError("Telegram", "Something failed", error);

    const body = sentTexts().join("\n");
    expect(body.match(/Error: boom/g)).toHaveLength(1);
  });

  it("names the host the alert came from", async () => {
    await logError("Telegram", "Something failed");

    expect(sentTexts()[0]).toContain("[Telegram (test) @ c0ffee1nstance]");
  });

  it("keeps the header when the runtime produced no stack", async () => {
    const error = new Error("boom");
    error.stack = undefined;
    await logError("Telegram", "Something failed", error);

    expect(sentTexts().join("\n")).toContain("Error: boom");
  });
});

describe("logErrorForApps", () => {
  it("sends one alert naming every affected app", async () => {
    await logErrorForApps(
      ["Telegram", "WhatsApp", "Matrix", "Tchap"],
      "JORFSearch is unreachable"
    );

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain("Telegram, WhatsApp, Matrix, Tchap");
    // Per-app analytics parity is kept even though the alert is shared.
    expect(umamiLogSpy).toHaveBeenCalledTimes(4);
  });

  it("sends nothing when no app is affected", async () => {
    await logErrorForApps([], "nobody cares");
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("logWarningForApps", () => {
  it("sends one warning naming every affected app", async () => {
    await logWarningForApps(
      ["Telegram", "WhatsApp"],
      "Notification process took too long"
    );

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(sentTexts()[0]).toContain("⚠️ [Telegram, WhatsApp");
    // A warning is not an error: it must not move the per-app error counters.
    expect(umamiLogSpy).not.toHaveBeenCalled();
  });

  it("sends nothing when no app is affected", async () => {
    await logWarningForApps([], "nobody cares");
    expect(postSpy).not.toHaveBeenCalled();
  });
});
