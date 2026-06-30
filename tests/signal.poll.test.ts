import { beforeEach, describe, expect, it } from "vitest";
import { SignalCli } from "signal-sdk";
import {
  clearPollRegistry,
  registerPollMenu,
  resolvePollVote
} from "../entities/SignalPollRegistry.ts";
import { sendSignalPollMenu } from "../entities/SignalSession.ts";
import { KEYBOARD_KEYS, POLL_MENU_KEYS } from "../entities/Keyboard.ts";

/**
 * Builds a fake SignalCli that records the PollCreateOptions it receives and
 * returns a fixed timestamp, mimicking signal-cli's SendResponse.
 */
function fakeSignalCli(timestamp: number, opts?: { throws?: boolean }) {
  const calls: {
    question: string;
    options: string[];
    recipients?: string[];
  }[] = [];
  const messages: { recipient: string; body: string }[] = [];
  const cli = {
    sendPollCreate: (params: {
      question: string;
      options: string[];
      recipients?: string[];
    }) => {
      if (opts?.throws) return Promise.reject(new Error("poll unsupported"));
      calls.push(params);
      return Promise.resolve({ timestamp, results: [] });
    },
    sendMessage: (recipient: string, body: string) => {
      messages.push({ recipient, body });
      return Promise.resolve({ timestamp, results: [] });
    }
  } as unknown as SignalCli;
  return { cli, calls, messages };
}

describe("SignalPollRegistry", () => {
  beforeEach(() => {
    clearPollRegistry();
  });

  it("resolves a vote index back to the registered option label", () => {
    registerPollMenu(1000, ["A", "B", "C"]);
    expect(resolvePollVote(1000, [0])).toBe("A");
    expect(resolvePollVote(1000, [2])).toBe("C");
  });

  it("returns undefined for an unknown poll timestamp", () => {
    expect(resolvePollVote(424242, [0])).toBeUndefined();
  });

  it("returns undefined for an out-of-range or empty option index", () => {
    registerPollMenu(2000, ["X", "Y"]);
    expect(resolvePollVote(2000, [5])).toBeUndefined();
    expect(resolvePollVote(2000, [])).toBeUndefined();
  });

  it("evicts the oldest entries beyond the size cap", () => {
    // Cap is 500; insert 520 and confirm the earliest are gone, latest remain.
    for (let i = 0; i < 520; i++)
      registerPollMenu(i, [`opt-${String(i)}`, "other"]);
    expect(resolvePollVote(0, [0])).toBeUndefined();
    expect(resolvePollVote(10, [0])).toBeUndefined();
    expect(resolvePollVote(519, [0])).toBe("opt-519");
  });
});

describe("sendSignalPollMenu", () => {
  beforeEach(() => {
    clearPollRegistry();
  });

  it("sends a single-select poll and registers the options", async () => {
    const { cli, calls } = fakeSignalCli(7777);
    const ok = await sendSignalPollMenu(cli, "33123456789", "Menu", [
      "First",
      "Second",
      "Third"
    ]);

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].question).toBe("Menu");
    expect(calls[0].options).toEqual(["First", "Second", "Third"]);
    // recipient is normalised to +E.164
    expect(calls[0].recipients).toEqual(["+33123456789"]);
    // the mapping is stored under the returned send timestamp
    expect(resolvePollVote(7777, [1])).toBe("Second");
  });

  it("clamps option labels to 100 characters", async () => {
    const long = "x".repeat(150);
    const { cli, calls } = fakeSignalCli(8888);
    await sendSignalPollMenu(cli, "+33123456789", "Menu", [long, "ok"]);

    expect(calls[0].options[0]).toHaveLength(100);
    expect(resolvePollVote(8888, [0])).toHaveLength(100);
  });

  it("refuses to send a poll with fewer than 2 valid options", async () => {
    const { cli, calls } = fakeSignalCli(9999);
    const ok = await sendSignalPollMenu(cli, "+33123456789", "Menu", ["only"]);
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("returns false when the SDK rejects (so callers can fall back)", async () => {
    const { cli } = fakeSignalCli(1234, { throws: true });
    const ok = await sendSignalPollMenu(cli, "+33123456789", "Menu", [
      "a",
      "b"
    ]);
    expect(ok).toBe(false);
    expect(resolvePollVote(1234, [0])).toBeUndefined();
  });
});

describe("poll menu / keyboard parity", () => {
  it("every poll option label maps to a KEYBOARD_KEYS command", () => {
    const knownLabels = new Set(
      Object.values(KEYBOARD_KEYS).map((k) => k.key.text)
    );
    for (const key of POLL_MENU_KEYS) {
      // A resolved poll vote is dispatched by matching this exact text in
      // processMessage, so each poll label must exist as a keyboard command.
      expect(knownLabels.has(key.text)).toBe(true);
    }
  });
});
