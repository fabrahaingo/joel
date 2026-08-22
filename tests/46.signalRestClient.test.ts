import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseSignalFrame,
  parsePollVote,
  SignalRestClient,
  type SignalEnvelopeMessage,
  type WebSocketLike
} from "../utils/signalRestClient.ts";

afterEach(() => vi.restoreAllMocks());

describe("parseSignalFrame", () => {
  it("returns the envelope for a data message", () => {
    const frame = JSON.stringify({
      envelope: { sourceNumber: "+33600000000", dataMessage: { message: "hi" } }
    });
    const res = parseSignalFrame(frame);
    expect(res?.envelope.dataMessage?.message).toBe("hi");
  });

  it("ignores frames without a dataMessage (receipts/typing/sync)", () => {
    const frame = JSON.stringify({
      envelope: { sourceNumber: "+33600000000", receiptMessage: {} }
    });
    expect(parseSignalFrame(frame)).toBeNull();
  });

  it("ignores non-string and non-JSON input", () => {
    expect(parseSignalFrame(123)).toBeNull();
    expect(parseSignalFrame("not json")).toBeNull();
  });
});

interface WsEvent {
  data?: unknown;
}

// Minimal fake WebSocket implementing WebSocketLike + event dispatch.
class FakeWS implements WebSocketLike {
  handlers: Record<string, ((ev: WsEvent) => void)[]> = {};
  static last: FakeWS;
  closed = false;
  constructor(public url: string) {
    FakeWS.last = this;
  }
  addEventListener(type: string, cb: (ev: WsEvent) => void) {
    (this.handlers[type] ??= []).push(cb);
  }
  emit(type: string, ev: WsEvent = {}) {
    (this.handlers[type] ?? []).forEach((h) => {
      h(ev);
    });
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

describe("SignalRestClient.connect / message", () => {
  it("opens a ws:// URL derived from an http:// api url and emits messages", async () => {
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      (url) => new FakeWS(url)
    );
    const received: unknown[] = [];
    client.on("message", (m: SignalEnvelopeMessage) => received.push(m));

    const connected = client.connect();
    FakeWS.last.emit("open");
    await connected;

    expect(FakeWS.last.url).toBe(
      "ws://signal-api:8080/v1/receive/+33111111111"
    );

    FakeWS.last.emit("message", {
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+33600000000",
          dataMessage: { message: "yo" }
        }
      })
    });
    expect(received).toHaveLength(1);

    client.disconnect();
    expect(FakeWS.last.closed).toBe(true);
  });

  it("reconnects after an unexpected close", () => {
    const urls: FakeWS[] = [];
    const client = new SignalRestClient(
      "https://signal-api:8080",
      "+33111111111",
      (url) => {
        const ws = new FakeWS(url);
        urls.push(ws);
        return ws;
      }
    );
    vi.useFakeTimers();
    void client.connect();
    urls[0].emit("open");
    // simulate a drop
    urls[0].emit("close");
    vi.runOnlyPendingTimers();
    expect(urls.length).toBe(2); // a new socket was opened
    expect(urls[0].url).toBe("wss://signal-api:8080/v1/receive/+33111111111");
    client.disconnect();
    vi.useRealTimers();
  });
});

describe("SignalRestClient.sendMessage", () => {
  it("POSTs to /v2/send with number, recipients and message", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 201 }));
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      () => new FakeWS("x")
    );
    await client.sendMessage("+33600000000", "hello");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://signal-api:8080/v2/send");
    expect(JSON.parse(init?.body as string)).toEqual({
      number: "+33111111111",
      recipients: ["+33600000000"],
      message: "hello"
    });
  });

  it("throws on a non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad number", { status: 400, statusText: "Bad Request" })
    );
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      () => new FakeWS("x")
    );
    await expect(client.sendMessage("+33600000000", "hi")).rejects.toThrow(
      /send failed: 400/
    );
  });
});

describe("SignalRestClient.sendTyping", () => {
  it("PUTs to /v1/typing-indicator/{bot} with the recipient", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      () => new FakeWS("x")
    );
    await client.sendTyping("+33600000000");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://signal-api:8080/v1/typing-indicator/+33111111111");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({
      recipient: "+33600000000"
    });
  });
});

describe("parsePollVote", () => {
  it("parses a vote frame into voter + timestamp + indexes", () => {
    const frame = JSON.stringify({
      envelope: {
        sourceNumber: "+33600000000",
        dataMessage: {
          message: null,
          pollVote: { targetSentTimestamp: 1783018038934, optionIndexes: [2] }
        }
      }
    });
    expect(parsePollVote(frame)).toEqual({
      sourceNumber: "+33600000000",
      targetSentTimestamp: "1783018038934",
      optionIndexes: [2]
    });
  });

  it("returns null for a plain text frame", () => {
    const frame = JSON.stringify({
      envelope: { sourceNumber: "+33600000000", dataMessage: { message: "hi" } }
    });
    expect(parsePollVote(frame)).toBeNull();
  });
});

describe("SignalRestClient polls", () => {
  it("createPoll POSTs to /v1/polls/{bot} and returns the timestamp", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ timestamp: "1783018038934" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      () => new FakeWS("x")
    );
    const ts = await client.createPoll("+33600000000", "Menu ?", [
      "📋 A",
      "💼 B"
    ]);
    expect(ts).toBe("1783018038934");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://signal-api:8080/v1/polls/+33111111111");
    expect(JSON.parse(init?.body as string)).toEqual({
      recipient: "+33600000000",
      question: "Menu ?",
      answers: ["📋 A", "💼 B"],
      allow_multiple_selections: false
    });
  });

  it("routes a vote to its label as a normal message and closes the poll", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ timestamp: "999" }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      (url) => new FakeWS(url)
    );
    const received: { envelope: { dataMessage?: { message?: string } } }[] = [];
    client.on("message", (m: SignalEnvelopeMessage) => received.push(m));

    const connected = client.connect();
    FakeWS.last.emit("open");
    await connected;

    // Register the poll (answers order matters for index -> label).
    await client.createPoll("+33600000000", "Menu ?", [
      "📋 Mes suivis",
      "💼 Fonctions"
    ]);

    // A vote for index 1 arrives.
    FakeWS.last.emit("message", {
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+33600000000",
          dataMessage: {
            message: null,
            pollVote: { targetSentTimestamp: 999, optionIndexes: [1] }
          }
        }
      })
    });

    // Emitted as a normal message carrying the resolved label.
    expect(received).toHaveLength(1);
    expect(received[0].envelope.dataMessage?.message).toBe("💼 Fonctions");

    // The poll was closed (DELETE) for the voter.
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
    expect(del).toBeDefined();
    expect(del?.[0]).toBe("http://signal-api:8080/v1/polls/+33111111111");
    expect(JSON.parse(del?.[1]?.body as string)).toEqual({
      recipient: "+33600000000",
      poll_timestamp: "999"
    });

    client.disconnect();
  });

  it("surfaces the main menu for a vote on an unknown poll (e.g. after restart)", async () => {
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      (url) => new FakeWS(url)
    );
    const received: { envelope: { dataMessage?: { message?: string } } }[] = [];
    client.on("message", (m: SignalEnvelopeMessage) => received.push(m));
    const connected = client.connect();
    FakeWS.last.emit("open");
    await connected;

    FakeWS.last.emit("message", {
      data: JSON.stringify({
        envelope: {
          sourceNumber: "+33600000000",
          dataMessage: {
            message: null,
            pollVote: { targetSentTimestamp: 12345, optionIndexes: [0] }
          }
        }
      })
    });
    // Not resolvable -> re-emit as the main-menu label so the user isn't stuck.
    expect(received).toHaveLength(1);
    expect(received[0].envelope.dataMessage?.message).toContain(
      "Menu principal"
    );
    client.disconnect();
  });
});

describe("SignalRestClient.isConnected", () => {
  it("tracks the receive socket from connect to disconnect", async () => {
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      (url) => new FakeWS(url)
    );

    expect(client.isConnected).toBe(false);

    const connected = client.connect();
    FakeWS.last.emit("open");
    await connected;
    expect(client.isConnected).toBe(true);

    client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("reports a dropped socket before the reconnect lands", () => {
    const client = new SignalRestClient(
      "http://signal-api:8080",
      "+33111111111",
      (url) => new FakeWS(url)
    );
    vi.useFakeTimers();
    void client.connect();
    FakeWS.last.emit("open");
    FakeWS.last.emit("close");

    expect(client.isConnected).toBe(false);

    client.disconnect();
    vi.useRealTimers();
  });
});
