import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_HEALTH_PORTS,
  healthPort,
  isAppEnabled,
  resolveTargets,
  runHealthcheck
} from "../utils/healthProbe.ts";

const telegramEnv = { TELEGRAM_BOT_TOKEN: "token" };
const signalEnv = {
  SIGNAL_PHONE_NUMBER: "+33600000000",
  SIGNAL_API_URL: "http://signalapi:8080"
};
const whatsAppEnv = {
  WHATSAPP_USER_TOKEN: "t",
  WHATSAPP_APP_SECRET: "s",
  WHATSAPP_PHONE_NUMBER: "p"
};

const okResponse = () => new Response("{}", { status: 200 });
const failResponse = () => new Response("{}", { status: 503 });

describe("isAppEnabled", () => {
  it("requires every variable the bot needs to start", () => {
    expect(isAppEnabled("signal", signalEnv)).toBe(true);
    expect(
      isAppEnabled("signal", { SIGNAL_PHONE_NUMBER: "+33600000000" })
    ).toBe(false);
  });

  it("treats a blank value as unset, like the bots do", () => {
    expect(isAppEnabled("telegram", { TELEGRAM_BOT_TOKEN: "  " })).toBe(false);
  });
});

describe("healthPort", () => {
  it("defaults when the variable is unset or unusable", () => {
    expect(healthPort("matrix", {})).toBe(DEFAULT_HEALTH_PORTS.matrix);
    expect(healthPort("matrix", { MATRIX_HEALTH_PORT: "nope" })).toBe(
      DEFAULT_HEALTH_PORTS.matrix
    );
  });

  it("reads the configured port", () => {
    expect(healthPort("matrix", { MATRIX_HEALTH_PORT: "9002" })).toBe(9002);
    expect(healthPort("whatsapp", { WHATSAPP_APP_PORT: "8080" })).toBe(8080);
  });
});

describe("resolveTargets", () => {
  it("keeps only the apps the environment enables", () => {
    const { targets } = resolveTargets(
      ["telegram", "whatsapp", "matrix"],
      telegramEnv
    );

    expect(targets.map((target) => target.name)).toEqual(["telegram"]);
    expect(targets[0].url).toBe(
      `http://127.0.0.1:${String(DEFAULT_HEALTH_PORTS.telegram)}/health`
    );
  });

  it("names arguments that match no app", () => {
    const { unknown } = resolveTargets(["telegram", "carrier-pigeon"], {});

    expect(unknown).toEqual(["carrier-pigeon"]);
  });
});

describe("runHealthcheck", () => {
  it("succeeds when every enabled app answers 200", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));

    const result = await runHealthcheck(
      ["telegram", "whatsapp", "matrix"],
      { ...telegramEnv, ...whatsAppEnv },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when one enabled app is unhealthy", async () => {
    const fetchImpl = vi.fn((url: string) =>
      Promise.resolve(
        url.includes(String(DEFAULT_HEALTH_PORTS.telegram))
          ? failResponse()
          : okResponse()
      )
    );

    const result = await runHealthcheck(
      ["telegram", "whatsapp"],
      { ...telegramEnv, ...whatsAppEnv },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["telegram: HTTP 503"]);
  });

  it("fails when an app refuses the connection", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new Error("ECONNREFUSED 127.0.0.1:3003"))
    );

    const result = await runHealthcheck(["signal"], signalEnv, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["signal: ECONNREFUSED 127.0.0.1:3003"]);
  });

  it("skips an app the environment leaves switched off", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));

    const result = await runHealthcheck(
      ["telegram", "whatsapp", "matrix"],
      telegramEnv,
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails when no named app is configured", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(okResponse()));

    const result = await runHealthcheck(
      ["telegram", "matrix"],
      {},
      {
        fetchImpl: fetchImpl as unknown as typeof fetch
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("no configured app");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails on an unknown app name rather than probing nothing", async () => {
    const result = await runHealthcheck(
      ["signal", "smoke-signals"],
      signalEnv,
      {
        fetchImpl: vi.fn(() =>
          Promise.resolve(okResponse())
        ) as unknown as typeof fetch
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("smoke-signals");
  });

  it("times out a probe that never answers", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        })
    );

    const result = await runHealthcheck(["signal"], signalEnv, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10
    });

    expect(result.exitCode).toBe(1);
    expect(result.lines[0]).toContain("signal:");
  });
});
