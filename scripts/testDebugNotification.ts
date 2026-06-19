import "dotenv/config";
import { sendTelegramDebugMessage } from "../utils/debugLogger.ts";

/**
 * Sends a test message through the debug Telegram pipeline to verify that
 * DEBUG_CHAT_ID / TELEGRAM_DEBUG_BOT_TOKEN are configured and reachable.
 *
 * Run with: npm run debug:notify
 *
 * sendTelegramDebugMessage silently no-ops when the env vars are missing and
 * swallows API errors (logging status + response body), so we pre-check the
 * config here and exit non-zero when it is incomplete.
 */
async function main(): Promise<void> {
  const missing = ["DEBUG_CHAT_ID", "TELEGRAM_DEBUG_BOT_TOKEN"].filter(
    (key) => (process.env[key] ?? "").trim().length === 0
  );

  if (missing.length > 0) {
    console.error(
      `Cannot test debug notification — missing env: ${missing.join(", ")}`
    );
    process.exit(1);
  }

  const stamp = new Date().toISOString();
  console.log("Sending test debug notification...");
  await sendTelegramDebugMessage(
    `✅ Debug notification test — pipeline is working (${stamp})`
  );
  console.log(
    "Done. Check the debug chat for the message. If it did not arrive, " +
      "the Telegram API error (status + response body) was logged above."
  );
}

main().catch((error: unknown) => {
  console.error("Debug notification test failed:", error);
  process.exit(1);
});
