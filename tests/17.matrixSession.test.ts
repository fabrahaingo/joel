import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { logErrorSpy, userState } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  userState: { current: null }
}));

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../models/User.ts", () => ({
  default: {
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(userState.current) })),
    updateOne: vi.fn(() => Promise.resolve({}))
  }
}));

import {
  sendMatrixMessage,
  sendPollMenu,
  closePollMenu,
  extractMatrixSession,
  MatrixSession,
  resetMatrixSessionCaches
} from "../entities/MatrixSession.ts";
import User from "../models/User.ts";
import type { ISession } from "../types.ts";
import type { MatrixClient } from "matrix-bot-sdk";

interface FakeClient {
  getJoinedRooms: ReturnType<typeof vi.fn>;
  getAccountData: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  sendEvent: ReturnType<typeof vi.fn>;
}
const makeClient = (
  over: Partial<FakeClient> = {}
): {
  client: MatrixClient;
  fake: FakeClient;
} => {
  const fake: FakeClient = {
    getJoinedRooms: vi.fn(() => Promise.resolve(["!room:hs"])),
    getAccountData: vi.fn(() => Promise.resolve({ "@u:hs": ["!room:hs"] })),
    sendMessage: vi.fn(() => Promise.resolve("$evt")),
    sendEvent: vi.fn(() => Promise.resolve("$evt")),
    ...over
  };
  return { client: fake as unknown as MatrixClient, fake };
};

const ext = (client: MatrixClient) => ({
  matrix: client,
  messageApp: "Matrix" as const
});
const baseOpt = {
  useAsyncUmamiLog: false,
  hasAccount: true,
  forceNoKeyboard: true
};

beforeEach(() => {
  userState.current = null;
  resetMatrixSessionCaches();
  vi.stubGlobal("setTimeout", (fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("sendMatrixMessage", () => {
  it("sends to a known room and records delivery", async () => {
    const { client, fake } = makeClient();
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(true);
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
    expect(fake.sendMessage.mock.calls[0][0]).toBe("!room:hs");
  });

  it("resolves the DM room from m.direct when no roomId is stored", async () => {
    const { client, fake } = makeClient();
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(true);
    expect(fake.getAccountData).toHaveBeenCalledWith("m.direct");
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "Matrix", chatId: "@u:hs" },
      { $set: { roomId: "!room:hs" } }
    );
  });

  it("returns false when no DM room can be found", async () => {
    const { client } = makeClient({
      getAccountData: vi.fn(() => Promise.resolve({}))
    });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@nobody:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(false);
  });

  it("blocks an active user on M_FORBIDDEN", async () => {
    userState.current = { status: "active" };
    const { client } = makeClient({
      sendMessage: vi.fn(() =>
        Promise.reject(
          Object.assign(new Error("forbidden"), { errcode: "M_FORBIDDEN" })
        )
      )
    });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(false);
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "Matrix", chatId: "@u:hs" },
      { $set: { status: "blocked" } }
    );
  });

  it("retries on M_LIMIT_EXCEEDED then aborts", async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("limit"), { errcode: "M_LIMIT_EXCEEDED" })
      )
    );
    const { client } = makeClient({ sendMessage });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(false);
    expect(sendMessage.mock.calls.length).toBeGreaterThan(5);
  });

  it("sends reactions for the keyboard when not forcing no keyboard", async () => {
    const { client, fake } = makeClient();
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hello",
      {
        useAsyncUmamiLog: false,
        hasAccount: true,
        keyboard: [[{ text: "👍" }]]
      }
    );
    expect(res).toBe(true);
    expect(fake.sendEvent).toHaveBeenCalled();
  });
});

describe("sendPollMenu / closePollMenu", () => {
  it("sends a poll start event", async () => {
    const { client, fake } = makeClient();
    const res = await sendPollMenu(ext(client), "!room:hs", {
      title: "Menu",
      options: [{ text: "A" }, { text: "B" }]
    });
    expect(res).toBe(true);
    expect(fake.sendEvent).toHaveBeenCalledWith(
      "!room:hs",
      "org.matrix.msc3381.poll.start",
      expect.any(Object)
    );
  });

  it("sends a poll end event", async () => {
    const { client, fake } = makeClient();
    const res = await closePollMenu(client, "!room:hs", "$evt");
    expect(res).toBe(true);
    expect(fake.sendEvent).toHaveBeenCalledWith(
      "!room:hs",
      "org.matrix.msc3381.poll.end",
      expect.any(Object)
    );
  });
});

describe("MatrixSession + extractMatrixSession", () => {
  it("throws for an invalid messageApp", () => {
    const { client } = makeClient();
    expect(
      () =>
        new MatrixSession(
          "Signal" as unknown as "Matrix",
          client,
          "@u:hs",
          "!room:hs",
          "fr",
          new Date()
        )
    ).toThrow();
  });

  it("returns a real MatrixSession", async () => {
    const { client } = makeClient();
    const s = new MatrixSession(
      "Matrix",
      client,
      "@u:hs",
      "!room:hs",
      "fr",
      new Date()
    );
    expect(await extractMatrixSession(s)).toBe(s);
  });

  it("returns undefined for a non-Matrix session instance", async () => {
    const fake = {
      messageApp: "Matrix",
      sendMessage: vi.fn(() => Promise.resolve(true))
    } as unknown as ISession;
    expect(await extractMatrixSession(fake)).toBeUndefined();
  });

  it("extractMessageAppsOptions returns the matrixClient for Matrix", () => {
    const { client } = makeClient();
    const s = new MatrixSession(
      "Matrix",
      client,
      "@u:hs",
      "!room:hs",
      "fr",
      new Date()
    );
    expect(s.extractMessageAppsOptions()).toEqual({ matrixClient: client });
  });
});
