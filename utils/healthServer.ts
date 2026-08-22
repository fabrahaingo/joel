import http from "node:http";
import mongoose from "mongoose";
import { MessageApp } from "../types.ts";
import { logError } from "./debugLogger.ts";

/** Path the container HEALTHCHECK probes on every app. */
export const HEALTH_PATH = "/health";

/** Loopback only: the container's own probe is the sole caller. */
const HEALTH_HOST = "127.0.0.1";

export interface HealthCheck {
  ok: boolean;
  detail?: string;
}

export type HealthProbe = () => HealthCheck | Promise<HealthCheck>;

export interface HealthReport {
  statusCode: 200 | 503;
  body: {
    status: "ok" | "unhealthy";
    app: MessageApp;
    uptimeSeconds: number;
    checks: Record<string, HealthCheck>;
  };
}

/** True while mongoose holds an open connection. */
export const mongoProbe: HealthProbe = () => {
  const ready =
    mongoose.connection.readyState === mongoose.ConnectionStates.connected;
  return ready
    ? { ok: true }
    : {
        ok: false,
        detail: `mongoose readyState ${String(mongoose.connection.readyState)}`
      };
};

/**
 * Runs every probe and folds the results into one report. A probe that throws
 * counts as a failure carrying its message, so a broken probe can never make
 * an unhealthy app look healthy.
 */
export const buildHealthReport = async (
  app: MessageApp,
  probes: Record<string, HealthProbe>,
  uptimeSeconds: number
): Promise<HealthReport> => {
  const checks: Record<string, HealthCheck> = {};

  for (const [name, probe] of Object.entries(probes)) {
    try {
      checks[name] = await probe();
    } catch (error) {
      checks[name] = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return {
    statusCode: ok ? 200 : 503,
    body: {
      status: ok ? "ok" : "unhealthy",
      app,
      uptimeSeconds: Math.round(uptimeSeconds),
      checks
    }
  };
};

/**
 * Serves GET /health for one bot process.
 *
 * The Telegram, Matrix and Signal bots hold no HTTP server of their own, and
 * the three of them share a container, so each needs its own port for the
 * image's HEALTHCHECK to tell a live bot from a dead one. WhatsApp instead
 * mounts {@link buildHealthReport} on the express app it already listens with.
 *
 * The returned server is unref'd: a stalled probe connection must not keep the
 * process alive once the bot has shut down.
 */
export const startHealthServer = (
  app: MessageApp,
  port: number,
  probes: Record<string, HealthProbe>
): http.Server => {
  const startedAt = Date.now();

  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.method !== "GET" || req.url?.split("?")[0] !== HEALTH_PATH) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }

      const report = await buildHealthReport(
        app,
        probes,
        (Date.now() - startedAt) / 1000
      );
      res.writeHead(report.statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report.body));
    })();
  });

  server.on("error", (error) => {
    void logError(app, `Health server failed on port ${String(port)}`, error);
  });

  server.listen(port, HEALTH_HOST);
  server.unref();
  return server;
};
