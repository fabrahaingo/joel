import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";

const { logErrorSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve())
}));

vi.mock("../utils/debugLogger.ts", () => ({
  logError: logErrorSpy
}));

const { buildHealthReport, HEALTH_PATH, startHealthServer } =
  await import("../utils/healthServer.ts");

const servers: ReturnType<typeof startHealthServer>[] = [];

const listenOnFreePort = async (
  probes: Parameters<typeof startHealthServer>[2]
): Promise<string> => {
  const server = startHealthServer("Telegram", 0, probes);
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(port)}`;
};

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

describe("buildHealthReport", () => {
  it("reports 200 when every probe passes", async () => {
    const report = await buildHealthReport(
      "Matrix",
      { mongo: () => ({ ok: true }), sync: () => ({ ok: true }) },
      12.4
    );

    expect(report.statusCode).toBe(200);
    expect(report.body).toEqual({
      status: "ok",
      app: "Matrix",
      uptimeSeconds: 12,
      checks: { mongo: { ok: true }, sync: { ok: true } }
    });
  });

  it("reports 503 and keeps the detail when one probe fails", async () => {
    const report = await buildHealthReport(
      "Signal",
      {
        mongo: () => ({ ok: true }),
        signalSocket: () => ({ ok: false, detail: "disconnected" })
      },
      1
    );

    expect(report.statusCode).toBe(503);
    expect(report.body.status).toBe("unhealthy");
    expect(report.body.checks.signalSocket).toEqual({
      ok: false,
      detail: "disconnected"
    });
  });

  it("treats a throwing probe as a failure carrying its message", async () => {
    const report = await buildHealthReport(
      "Telegram",
      {
        telegramApi: () => {
          throw new Error("getMe timed out");
        }
      },
      0
    );

    expect(report.statusCode).toBe(503);
    expect(report.body.checks.telegramApi).toEqual({
      ok: false,
      detail: "getMe timed out"
    });
  });

  it("awaits asynchronous probes", async () => {
    const report = await buildHealthReport(
      "Telegram",
      { slow: () => Promise.resolve({ ok: false, detail: "late" }) },
      0
    );

    expect(report.statusCode).toBe(503);
    expect(report.body.checks.slow).toEqual({ ok: false, detail: "late" });
  });
});

describe("startHealthServer", () => {
  it("serves 200 on the health path while probes pass", async () => {
    const base = await listenOnFreePort({ mongo: () => ({ ok: true }) });

    const response = await fetch(`${base}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ok",
      app: "Telegram"
    });
  });

  it("serves 503 once a probe fails", async () => {
    let healthy = true;
    const base = await listenOnFreePort({ link: () => ({ ok: healthy }) });

    expect((await fetch(`${base}${HEALTH_PATH}`)).status).toBe(200);
    healthy = false;
    expect((await fetch(`${base}${HEALTH_PATH}`)).status).toBe(503);
  });

  it("ignores the query string on the health path", async () => {
    const base = await listenOnFreePort({ mongo: () => ({ ok: true }) });

    expect((await fetch(`${base}${HEALTH_PATH}?full=1`)).status).toBe(200);
  });

  it("answers 404 on any other path", async () => {
    const base = await listenOnFreePort({ mongo: () => ({ ok: true }) });

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  });

  it("answers 404 on a non-GET request to the health path", async () => {
    const base = await listenOnFreePort({ mongo: () => ({ ok: true }) });

    expect(
      (await fetch(`${base}${HEALTH_PATH}`, { method: "POST" })).status
    ).toBe(404);
  });
});

describe("mongoProbe", () => {
  it("passes while mongoose holds a connection", async () => {
    const { mongoProbe } = await import("../utils/healthServer.ts");

    expect(mongoProbe()).toEqual({ ok: true });
  });
});
