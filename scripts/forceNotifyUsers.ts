import "dotenv/config";
import { runNotificationProcess } from "../notifications/runNotificationProcess.ts";
import { loadAllMessageApps } from "../utils/loadAllMessageApps.ts";
import { logError } from "../utils/debugLogger.ts";
import { MessageApp } from "../types.ts";

await (async () => {
  try {
    const { messageApps, messageAppOptions } = await loadAllMessageApps();
    await runNotificationProcess(messageApps, messageAppOptions);

    console.log("Notification process completed");

    process.exit(0);
  } catch (error) {
    await logError(
      "Forced notification" as MessageApp,
      "Forced notification failed",
      error
    );
    process.exit(1);
  }
})();
