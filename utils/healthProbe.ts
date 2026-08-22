import { HEALTH_PATH } from "./healthServer.ts";
import { isBlankEnv, parsePortEnv } from "./env.utils.ts";

export type HealthAppName = "telegram" | "whatsapp" | "matrix" | "signal";

export const HEALTH_APP_NAMES: HealthAppName[] = [
  "telegram",
  "whatsapp",
  "matrix",
  "signal"
];

/** Default health ports. WhatsApp answers on the port it already serves on. */
export const DEFAULT_HEALTH_PORTS: Record<HealthAppName, number> = {
  whatsapp: 3000,
  telegram: 3001,
  matrix: 3002,
  signal: 3003
};

export interface HealthTarget {
  name: HealthAppName;
  port: number;
  url: string;
}

type Env = Record<string, string | undefined>;

/**
 * Variables each bot requires to start. A bot whose variables are unset exits
 * with status 0 on purpose, so its port stays closed and probing it would fail
 * a container that is running exactly the subset it was configured for.
 */
const REQUIRED_ENV: Record<HealthAppName, string[]> = {
  telegram: ["TELEGRAM_BOT_TOKEN"],
  whatsapp: [
    "WHATSAPP_USER_TOKEN",
    "WHATSAPP_APP_SECRET",
    "WHATSAPP_PHONE_NUMBER"
  ],
  matrix: ["MATRIX_HOME_URL", "MATRIX_BOT_TOKEN", "MATRIX_BOT_TYPE"],
  signal: ["SIGNAL_PHONE_NUMBER", "SIGNAL_API_URL"]
};

const PORT_ENV: Record<HealthAppName, string> = {
  telegram: "TELEGRAM_HEALTH_PORT",
  whatsapp: "WHATSAPP_APP_PORT",
  matrix: "MATRIX_HEALTH_PORT",
  signal: "SIGNAL_HEALTH_PORT"
};

export const isHealthAppName = (value: string): value is HealthAppName =>
  (HEALTH_APP_NAMES as string[]).includes(value);

export const healthPort = (name: HealthAppName, env: Env): number =>
  parsePortEnv(env[PORT_ENV[name]], DEFAULT_HEALTH_PORTS[name]);

export const isAppEnabled = (name: HealthAppName, env: Env): boolean =>
  REQUIRED_ENV[name].every((variable) => !isBlankEnv(env[variable]));

/**
 * Turns the app names a container runs into the endpoints worth probing.
 *
 * The names come from the image's HEALTHCHECK arguments rather than from the
 * environment: both images are fed the same .env file, so only the command
 * line distinguishes the multi-bot image from the Signal-only one.
 */
export const resolveTargets = (
  names: string[],
  env: Env
): { targets: HealthTarget[]; unknown: string[] } => {
  const unknown = names.filter((name) => !isHealthAppName(name));
  const targets = names
    .filter(isHealthAppName)
    .filter((name) => isAppEnabled(name, env))
    .map((name) => {
      const port = healthPort(name, env);
      return {
        name,
        port,
        url: `http://127.0.0.1:${String(port)}${HEALTH_PATH}`
      };
    });
  return { targets, unknown };
};

export interface ProbeResult {
  exitCode: 0 | 1;
  lines: string[];
}

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 4000;

const probeOne = async (
  target: HealthTarget,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(target.url, { signal: controller.signal });
    if (response.status === 200) return null;
    return `${target.name}: HTTP ${String(response.status)}`;
  } catch (error) {
    return `${target.name}: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Probes every enabled app named on the command line.
 *
 * A container with no enabled app is reported unhealthy: it runs no bot, so
 * "nothing to check" is a misconfigured deployment, not a passing one.
 */
export const runHealthcheck = async (
  names: string[],
  env: Env,
  options: ProbeOptions = {}
): Promise<ProbeResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { targets, unknown } = resolveTargets(names, env);

  if (unknown.length > 0) {
    return {
      exitCode: 1,
      lines: [`unknown app name(s): ${unknown.join(", ")}`]
    };
  }

  if (targets.length === 0) {
    return {
      exitCode: 1,
      lines: [`no configured app among: ${names.join(", ")}`]
    };
  }

  const failures = (
    await Promise.all(
      targets.map((target) => probeOne(target, fetchImpl, timeoutMs))
    )
  ).filter((failure): failure is string => failure !== null);

  return failures.length === 0
    ? {
        exitCode: 0,
        lines: [`healthy: ${targets.map((t) => t.name).join(", ")}`]
      }
    : { exitCode: 1, lines: failures };
};
