import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { logErrorSpy, userState, findOrCreateSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  userState: { current: null, found: [] as unknown[] },
  findOrCreateSpy: vi.fn(() => Promise.resolve({ _id: "u1" }))
}));

vi.mock("../utils/umami.ts", () => ({
  default: { log: vi.fn(), logAsync: vi.fn() }
}));
vi.mock("../utils/debugLogger.ts", () => ({ logError: logErrorSpy }));
vi.mock("../models/User.ts", () => ({
  default: {
    find: vi.fn(() => Promise.resolve(userState.found)),
    findOne: vi.fn(() => ({ lean: () => Promise.resolve(userState.current) })),
    updateOne: vi.fn(() => Promise.resolve({})),
    findOrCreate: findOrCreateSpy
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
  userState.found = [];
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

  it("unsets a stored room that the bot is no longer joined to, then re-resolves", async () => {
    // Joined rooms only contain a fresh room; m.direct points to it. The first
    // send (no stored roomId) primes the joined-rooms cache; the second send with
    // a now-stale stored roomId must detect it's not joined and re-resolve.
    const { client, fake } = makeClient({
      getJoinedRooms: vi.fn(() => Promise.resolve(["!fresh:hs"])),
      getAccountData: vi.fn(() => Promise.resolve({ "@u:hs": ["!fresh:hs"] }))
    });
    await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "prime",
      baseOpt
    );
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!stale:hs" },
      "hello",
      baseOpt
    );
    expect(res).toBe(true);
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { messageApp: "Matrix", chatId: "@u:hs" },
      { $unset: { roomId: 1 } }
    );
    expect(fake.sendMessage.mock.calls.at(-1)?.[0]).toBe("!fresh:hs");
  });

  it("sends a separate poll menu when requested", async () => {
    const { client, fake } = makeClient();
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hello",
      { useAsyncUmamiLog: false, hasAccount: true, separateMenuMessage: true }
    );
    expect(res).toBe(true);
    // poll.start event emitted in addition to the text message
    const pollStart = fake.sendEvent.mock.calls.find(
      (c) => c[1] === "org.matrix.msc3381.poll.start"
    );
    expect(pollStart).toBeDefined();
  });

  it("returns false on M_FORBIDDEN even when no user record exists", async () => {
    userState.current = null;
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
  });
});

describe("MatrixSession — instance methods", () => {
  const make = (roomId = "!room:hs") => {
    const { client, fake } = makeClient();
    const session = new MatrixSession(
      "Matrix",
      client,
      "@u:hs",
      roomId,
      "fr",
      new Date()
    );
    return { session, fake };
  };

  it("loadUser returns the user and the shared loader syncs the roomId", async () => {
    userState.found = [
      {
        _id: "u1",
        roomId: "!old:hs",
        followsNothing: () => false,
        save: vi.fn(() => Promise.resolve())
      }
    ];
    const { session } = make("!new:hs");
    const user = await session.loadUser();
    expect(user).not.toBeNull();
    // Session.loadUser persists the new roomId via updateOne.
    expect(vi.mocked(User.updateOne)).toHaveBeenCalledWith(
      { _id: "u1" },
      { $set: { roomId: "!new:hs" } }
    );
  });

  it("createUser sets the user from findOrCreate", async () => {
    const { session } = make();
    await session.createUser();
    expect(findOrCreateSpy).toHaveBeenCalledWith(session);
  });

  it("sendTypingAction and log do not throw", () => {
    const { session } = make();
    expect(() => {
      session.sendTypingAction();
    }).not.toThrow();
    expect(() => {
      session.log({ event: "/message-sent" });
    }).not.toThrow();
  });

  it("sendMessage forwards to sendMatrixMessage", async () => {
    const { session, fake } = make();
    const res = await session.sendMessage("hi", { forceNoKeyboard: true });
    expect(res).toBe(true);
    expect(fake.sendMessage).toHaveBeenCalled();
  });

  it("extractMessageAppsOptions returns tchapClient for a Tchap session", () => {
    const { client } = makeClient();
    const session = new MatrixSession(
      "Tchap",
      client,
      "@u:tchap",
      "!room:tchap",
      "fr",
      new Date()
    );
    expect(session.extractMessageAppsOptions()).toEqual({
      tchapClient: client
    });
  });

  it("extractMessageAppsOptions throws for an unexpected client messageApp", () => {
    const { client } = makeClient();
    const session = new MatrixSession(
      "Matrix",
      client,
      "@u:hs",
      "!room:hs",
      "fr",
      new Date()
    );
    // Force the unreachable-by-construction default branch.
    (session.client as { messageApp: string }).messageApp = "Signal";
    expect(() => session.extractMessageAppsOptions()).toThrow();
  });
});

describe("sendMatrixMessage — more error & resolution paths", () => {
  it("retries on a network error then aborts", async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(Object.assign(new Error("net"), { code: "ECONNRESET" }))
    );
    const { client } = makeClient({ sendMessage });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(false);
    expect(sendMessage.mock.calls.length).toBeGreaterThan(5);
  });

  it("returns false on an unrecognised matrix error", async () => {
    const sendMessage = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("weird"), { errcode: "M_UNKNOWN" })
      )
    );
    const { client } = makeClient({ sendMessage });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(false);
  });

  it("returns false when joined rooms cannot be fetched and no DM exists", async () => {
    const { client } = makeClient({
      getJoinedRooms: vi.fn(() => Promise.reject(new Error("boom"))),
      getAccountData: vi.fn(() => Promise.resolve({}))
    });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(false);
  });

  it("returns false when m.direct lists only rooms the bot has not joined", async () => {
    const { client } = makeClient({
      getJoinedRooms: vi.fn(() => Promise.resolve(["!other:hs"])),
      getAccountData: vi.fn(() =>
        Promise.resolve({ "@u:hs": ["!notjoined:hs"] })
      )
    });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(false);
  });

  it("still delivers when persisting the resolved DM room fails", async () => {
    vi.mocked(User.updateOne).mockRejectedValueOnce(new Error("db"));
    const { client, fake } = makeClient();
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(true);
    expect(fake.sendMessage).toHaveBeenCalled();
  });

  it("still delivers when unsetting a stale room fails", async () => {
    const { client } = makeClient({
      getJoinedRooms: vi.fn(() => Promise.resolve(["!fresh:hs"])),
      getAccountData: vi.fn(() => Promise.resolve({ "@u:hs": ["!fresh:hs"] }))
    });
    await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "prime",
      baseOpt
    );
    vi.mocked(User.updateOne).mockRejectedValueOnce(new Error("db"));
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!stale:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(true);
  });

  it("reuses the cached DM room on a second send", async () => {
    const { client, fake } = makeClient();
    const target = { messageApp: "Matrix" as const, chatId: "@u:hs" };
    await sendMatrixMessage(ext(client), { ...target }, "first", baseOpt);
    await sendMatrixMessage(ext(client), { ...target }, "second", baseOpt);
    // m.direct only needs to be read once thanks to the DM cache.
    expect(fake.getAccountData.mock.calls.length).toBe(1);
  });

  it("retries a rate-limited reaction (honouring retryAfterMs) then aborts", async () => {
    const sendEvent = vi.fn(() =>
      Promise.reject(
        Object.assign(new Error("limit"), {
          errcode: "M_LIMIT_EXCEEDED",
          retryAfterMs: 50
        })
      )
    );
    const { client } = makeClient({ sendEvent });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs", roomId: "!room:hs" },
      "hi",
      {
        useAsyncUmamiLog: false,
        hasAccount: true,
        keyboard: [[{ text: "👍" }]]
      }
    );
    expect(res).toBe(false);
    expect(sendEvent.mock.calls.length).toBeGreaterThan(5);
  });

  it("returns false when reading m.direct fails", async () => {
    const { client } = makeClient({
      getJoinedRooms: vi.fn(() => Promise.resolve([])),
      getAccountData: vi.fn(() => Promise.reject(new Error("acct down")))
    });
    const res = await sendMatrixMessage(
      ext(client),
      { messageApp: "Matrix", chatId: "@u:hs" },
      "hi",
      baseOpt
    );
    expect(res).toBe(false);
  });
});

describe("extractMatrixSession — userFacingError", () => {
  it("sends the unavailable notice for a non-Matrix session", async () => {
    const fake = {
      messageApp: "Signal",
      sendMessage: vi.fn(() => Promise.resolve(true))
    } as unknown as ISession;
    const res = await extractMatrixSession(fake, true);
    expect(res).toBeUndefined();
    expect(fake.sendMessage).toHaveBeenCalledTimes(1);
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
