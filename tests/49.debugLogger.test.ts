import { describe, it, expect, vi, beforeEach } from "vitest";

const { postSpy, umamiLogSpy, isAxiosErrorLike } = vi.hoisted(() => ({
  postSpy: vi.fn(() => Promise.resolve({ data: {} })),
  umamiLogSpy: vi.fn(),
  isAxiosErrorLike: (e: unknown) =>
    (e as { isAxiosError?: boolean } | null)?.isAxiosError === true
}));

vi.mock("axios", () => ({
  default: {
    post: postSpy,
    // Pulled in transitively by the entities barrel debugLogger imports.
    create: () => ({ get: vi.fn(), post: vi.fn() }),
    isAxiosError: (e: unknown) => isAxiosErrorLike(e)
  },
  isAxiosError: (e: unknown) => isAxiosErrorLike(e)
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

describe("axios errors", () => {
  const axiosError = (
    message: string,
    fields: Record<string, unknown>
  ): Error => {
    const error = new Error(message);
    error.name = "AxiosError";
    error.stack = `AxiosError: ${message}
    at createTimeoutError (http.js:660:16)
    at async callJORFSearchPeople (JORFSearch.utils.js:34:16)`;
    return Object.assign(error, { isAxiosError: true }, fields);
  };

  it("renders a network failure on one line naming the host only", async () => {
    await logError(
      "Telegram",
      "JORFSearch unreachable",
      axiosError("connect ECONNREFUSED 95.216.0.254:443", {
        code: "ECONNREFUSED",
        config: {
          method: "get",
          url: "https://jorfsearch.steinertriples.ch/name/Jean%20Dupont?format=JSON"
        }
      })
    );

    const body = sentTexts()[0];
    expect(body).toContain(
      "AxiosError ECONNREFUSED: connect ECONNREFUSED 95.216.0.254:443 (GET jorfsearch.steinertriples.ch)"
    );
    expect(body).not.toContain("createTimeoutError");
    // The path carries what the user searched for.
    expect(body).not.toContain("Dupont");
  });

  it("names the HTTP status when the upstream answered", async () => {
    await logError(
      "Telegram",
      "JORFSearch unreachable",
      axiosError("Request failed with status code 503", {
        code: "ERR_BAD_RESPONSE",
        config: {
          method: "get",
          url: "https://jorfsearch.steinertriples.ch/x"
        },
        response: { status: 503 }
      })
    );

    expect(sentTexts()[0]).toContain(
      "AxiosError ERR_BAD_RESPONSE: Request failed with status code 503 (GET jorfsearch.steinertriples.ch, HTTP 503)"
    );
  });

  it("keeps the summary when the request URL cannot be parsed", async () => {
    await logError(
      "Telegram",
      "Something failed",
      axiosError("timeout of 10000ms exceeded", {
        code: "ECONNABORTED",
        config: { url: "not a url" }
      })
    );

    expect(sentTexts()[0]).toContain(
      "AxiosError ECONNABORTED: timeout of 10000ms exceeded"
    );
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
