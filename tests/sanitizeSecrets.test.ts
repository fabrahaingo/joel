import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { sanitizeSecrets } from "../utils/debugLogger.ts";

describe("sanitizeSecrets", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Use a fresh isolated copy so tests don't interfere with each other
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("replaces a secret value with its placeholder name", () => {
    process.env.TELEGRAM_BOT_TOKEN = "super-secret-token-abcdefgh";
    const result = sanitizeSecrets(
      "Connecting with token super-secret-token-abcdefgh"
    );
    expect(result).toBe("Connecting with token <TELEGRAM_BOT_TOKEN>");
    expect(result).not.toContain("super-secret-token-abcdefgh");
  });

  it("replaces multiple different secrets in the same string", () => {
    process.env.MONGODB_URI = "mongodb://user:password@host:27017/db";
    process.env.TELEGRAM_BOT_TOKEN = "tg-bot-token-xyz12345";
    const input =
      "URI=mongodb://user:password@host:27017/db token=tg-bot-token-xyz12345";
    const result = sanitizeSecrets(input);
    expect(result).toContain("<MONGODB_URI>");
    expect(result).toContain("<TELEGRAM_BOT_TOKEN>");
    expect(result).not.toContain("mongodb://user:password@host:27017/db");
    expect(result).not.toContain("tg-bot-token-xyz12345");
  });

  it("does not replace values shorter than 8 characters", () => {
    process.env.SHORT_VAR = "tiny";
    const result = sanitizeSecrets("This is a tiny value");
    expect(result).toBe("This is a tiny value");
  });

  it("does not replace values that are exactly 7 characters", () => {
    process.env.SEVEN_CHAR = "1234567";
    const result = sanitizeSecrets("Value is 1234567 here");
    expect(result).toBe("Value is 1234567 here");
  });

  it("replaces values that are exactly 8 characters", () => {
    process.env.EIGHT_CHAR = "12345678";
    const result = sanitizeSecrets("Value is 12345678 here");
    expect(result).toBe("Value is <EIGHT_CHAR> here");
  });

  it("handles strings with no secrets unchanged", () => {
    const input = "No secrets here, just a normal log message.";
    expect(sanitizeSecrets(input)).toBe(input);
  });

  it("replaces all occurrences of a secret in the same string", () => {
    process.env.API_SECRET_KEY = "my-api-secret-key";
    const input = "key=my-api-secret-key and backup_key=my-api-secret-key";
    const result = sanitizeSecrets(input);
    expect(result).toBe("key=<API_SECRET_KEY> and backup_key=<API_SECRET_KEY>");
  });

  it("handles the longer secret first to avoid partial replacement", () => {
    process.env.SHORT_SECRET = "abcdefgh";
    process.env.LONG_SECRET = "abcdefgh-extra-suffix";
    const input = "value=abcdefgh-extra-suffix";
    const result = sanitizeSecrets(input);
    // The longer value should be replaced first, so we get <LONG_SECRET>, not <SHORT_SECRET>-extra-suffix
    expect(result).toBe("value=<LONG_SECRET>");
  });

  it("returns the input unchanged when process.env has no qualifying values", () => {
    // Replace all env vars with values >= 8 chars with short placeholders
    for (const key of Object.keys(process.env)) {
      const val = process.env[key];
      if (val != null && val.trim().length >= 8) {
        process.env[key] = "";
      }
    }
    const input = "Safe log message";
    expect(sanitizeSecrets(input)).toBe(input);
  });
});
