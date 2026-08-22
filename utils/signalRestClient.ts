import { EventEmitter } from "node:events";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";

export interface SignalEnvelopeMessage {
  envelope: {
    sourceNumber: string;
    dataMessage?: { message?: string };
  };
}

// Minimal surface of the global WebSocket the adapter relies on. Lets tests
// inject a fake without a real socket.
export interface WebSocketLike {
  addEventListener(type: string, cb: (ev: { data?: unknown }) => void): void;
  close(): void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CONNECT_TIMEOUT_MS = 30_000;
// Cap on tracked polls so a long-running bot never leaks registry entries.
const MAX_TRACKED_POLLS = 200;

// A poll vote as it arrives on the receive stream. The vote carries the option
// index, not the label; the label is recovered from the poll registry.
export interface SignalPollVote {
  sourceNumber: string;
  targetSentTimestamp: string;
  optionIndexes: number[];
}

// Parse a signal-cli-rest-api receive frame into the envelope shape the bot
// consumes. Returns null for anything that is not an actionable text message
// (receipts, typing, sync, poll votes, malformed frames).
export function parseSignalFrame(data: unknown): SignalEnvelopeMessage | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const env = (parsed as Partial<SignalEnvelopeMessage> | null)?.envelope;
  if (env?.dataMessage?.message == null) return null;
  return parsed as SignalEnvelopeMessage;
}

// Parse a poll vote frame. Returns null unless the frame is a well-formed vote.
export function parsePollVote(data: unknown): SignalPollVote | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const env = (
    parsed as {
      envelope?: {
        sourceNumber?: string;
        dataMessage?: {
          pollVote?: { targetSentTimestamp?: number; optionIndexes?: number[] };
        };
      };
    } | null
  )?.envelope;
  const vote = env?.dataMessage?.pollVote;
  if (
    env?.sourceNumber == null ||
    vote?.targetSentTimestamp == null ||
    !Array.isArray(vote.optionIndexes)
  ) {
    return null;
  }
  return {
    sourceNumber: env.sourceNumber,
    targetSentTimestamp: String(vote.targetSentTimestamp),
    optionIndexes: vote.optionIndexes
  };
}

export class SignalRestClient extends EventEmitter {
  private readonly apiUrl: string;
  private readonly wsUrl: string;
  private readonly phoneNumber: string;
  private readonly wsFactory: (url: string) => WebSocketLike;
  private ws: WebSocketLike | null = null;
  private reconnectAttempts = 0;
  private intentionalShutdown = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Poll timestamp -> the recipient and ordered answer labels, so an incoming
  // vote (which carries only the option index) can be resolved back to a label.
  private readonly pollRegistry = new Map<
    string,
    { recipient: string; answers: string[] }
  >();

  constructor(
    apiUrl: string,
    phoneNumber: string,
    wsFactory: (url: string) => WebSocketLike = (url) => new WebSocket(url)
  ) {
    super();
    this.apiUrl = apiUrl.replace(/\/+$/, "");
    this.phoneNumber = phoneNumber;
    this.wsFactory = wsFactory;
    const wsBase = this.apiUrl.replace(/^http/, "ws"); // http->ws, https->wss
    this.wsUrl = `${wsBase}/v1/receive/${phoneNumber}`;
  }

  /** True while the receive WebSocket is open. */
  get isConnected(): boolean {
    return this.ws !== null;
  }

  connect(): Promise<void> {
    this.intentionalShutdown = false;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Signal rest-api WebSocket connect timed out"));
      }, CONNECT_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();
      this.openSocket(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private openSocket(onOpen?: () => void): void {
    const ws = this.wsFactory(this.wsUrl);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      onOpen?.();
    });
    ws.addEventListener("message", (ev: { data?: unknown }) => {
      const parsed = parseSignalFrame(ev.data);
      if (parsed) {
        this.emit("message", parsed);
        return;
      }
      const vote = parsePollVote(ev.data);
      if (vote) this.handlePollVote(vote);
    });
    ws.addEventListener("close", () => {
      this.ws = null;
      if (!this.intentionalShutdown) this.scheduleReconnect();
    });
    // 'error' is followed by 'close'; reconnection is handled there.
    ws.addEventListener("error", () => undefined);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionalShutdown) this.openSocket();
    }, delay);
    if (typeof this.reconnectTimer.unref === "function") {
      this.reconnectTimer.unref();
    }
  }

  async sendMessage(recipient: string, message: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/v2/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: this.phoneNumber,
        recipients: [recipient],
        message
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `signal-cli-rest-api send failed: ${String(res.status)} ${res.statusText} ${body}`.trim()
      );
    }
  }

  // Send a native Signal poll and remember its answers so an incoming vote can
  // be mapped back to a label. Returns the poll timestamp (its id).
  async createPoll(
    recipient: string,
    question: string,
    answers: string[]
  ): Promise<string> {
    const res = await fetch(`${this.apiUrl}/v1/polls/${this.phoneNumber}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient,
        question,
        answers,
        allow_multiple_selections: false
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `signal-cli-rest-api poll create failed: ${String(res.status)} ${res.statusText} ${body}`.trim()
      );
    }
    const { timestamp } = (await res.json()) as { timestamp: string };
    // Evict the oldest entry if the registry is full (insertion order).
    if (this.pollRegistry.size >= MAX_TRACKED_POLLS) {
      const oldest = this.pollRegistry.keys().next().value;
      if (oldest !== undefined) this.pollRegistry.delete(oldest);
    }
    this.pollRegistry.set(timestamp, { recipient, answers });
    return timestamp;
  }

  // Show the "…is typing" indicator to a recipient. Signal clears it on the
  // next message or after its own timeout, so no explicit stop is needed.
  async sendTyping(recipient: string): Promise<void> {
    const res = await fetch(
      `${this.apiUrl}/v1/typing-indicator/${this.phoneNumber}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient })
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `signal-cli-rest-api typing failed: ${String(res.status)} ${res.statusText} ${body}`.trim()
      );
    }
  }

  async closePoll(recipient: string, pollTimestamp: string): Promise<void> {
    const res = await fetch(`${this.apiUrl}/v1/polls/${this.phoneNumber}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient, poll_timestamp: pollTimestamp })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `signal-cli-rest-api poll close failed: ${String(res.status)} ${res.statusText} ${body}`.trim()
      );
    }
  }

  // Resolve a vote to its answer label and replay it as a normal inbound
  // message, so the existing command dispatcher handles the selection. Then
  // close the poll so it can't be voted on again.
  private handlePollVote(vote: SignalPollVote): void {
    const entry = this.pollRegistry.get(vote.targetSentTimestamp);
    if (entry == null) {
      // Unknown poll — e.g. one created before a restart, whose answers are no
      // longer in memory. The vote only carries an index, so the choice can't
      // be resolved; surface the main menu so the user isn't left stuck.
      this.emit("message", {
        envelope: {
          sourceNumber: vote.sourceNumber,
          dataMessage: { message: KEYBOARD_KEYS.MAIN_MENU.key.text }
        }
      } satisfies SignalEnvelopeMessage);
      return;
    }
    const label = entry.answers.at(vote.optionIndexes[0]);
    if (label == null) return;

    this.emit("message", {
      envelope: {
        sourceNumber: vote.sourceNumber,
        dataMessage: { message: label }
      }
    } satisfies SignalEnvelopeMessage);

    this.pollRegistry.delete(vote.targetSentTimestamp);
    void this.closePoll(entry.recipient, vote.targetSentTimestamp).catch(
      (err: unknown) => {
        console.error("Signal: failed to close poll", err);
      }
    );
  }

  disconnect(): void {
    this.intentionalShutdown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
