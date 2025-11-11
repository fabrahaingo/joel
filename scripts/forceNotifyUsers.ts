import "dotenv/config";
import { runNotificationProcess } from "../notifications/runNotificationProcess.ts";
import { loadAllMessageApps } from "../utils/loadAllMessageApps.ts";

await (async () => {
  try {
    const { messageApps, messageAppOptions } = await loadAllMessageApps();
    await runNotificationProcess(messageApps, messageAppOptions);

    console.log("Notification process completed");

    process.exit(0);
  } catch (error) {
    console.error("Notification failed:", error);
    process.exit(1);
  }
})();
