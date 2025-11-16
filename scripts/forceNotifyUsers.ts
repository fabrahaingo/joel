import "dotenv/config";
import { runNotificationProcess } from "../notifications/runNotificationProcess.ts";
import { loadAllMessageApps } from "../utils/loadAllMessageApps.ts";
import { session } from "telegraf";
import umami from "../utils/umami.ts";

await (async () => {
  try {
    const { messageApps, messageAppOptions } = await loadAllMessageApps();
    await runNotificationProcess(messageApps, messageAppOptions);

    console.log("Notification process completed");

    process.exit(0);
  } catch (error) {
    console.error("Notification failed:", error);
    await umami.log({ event: "/console-log" });
    process.exit(1);
  }
})();
