const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Reads a boolean environment variable. `Boolean(value)` cannot be used here:
 * it is true for the strings "false" and "0", so a variable meant to switch a
 * feature off would silently leave it on.
 */
export const parseBooleanEnv = (
  value: string | undefined,
  fallback: boolean
): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (normalized == null || normalized.length === 0) return fallback;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return fallback;
};

/**
 * True when a variable is unset or blank. Coolify leaves an unresolved shared
 * variable as an empty string, which is as unusable as an absent one.
 */
export const isBlankEnv = (value: string | undefined): value is undefined =>
  value == null || value.trim().length === 0;

/**
 * Names the variables of the given record that are unset or blank, so a bot
 * that declines to start can say which one is missing.
 */
export const missingEnvVars = (
  vars: Record<string, string | undefined>
): string[] =>
  Object.entries(vars)
    .filter(([, value]) => isBlankEnv(value))
    .map(([name]) => name);

/**
 * Reads a TCP port from the environment, falling back when the value is
 * absent, blank or not a port number.
 */
export const parsePortEnv = (
  value: string | undefined,
  fallback: number
): number => {
  if (isBlankEnv(value)) return fallback;
  const port = Number(value.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fallback;
  return port;
};
