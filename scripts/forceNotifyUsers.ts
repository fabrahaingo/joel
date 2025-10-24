import "dotenv/config";
import { runNotificationProcess } from "../notifications/runNotificationProcess.ts";
import { loadAllMessageApps } from "../utils/loadAllMessageApps.ts";

await (async () => {
  const { messageApps, messageAppOptions } = await loadAllMessageApps();
  await runNotificationProcess(messageApps, messageAppOptions);

  console.log("Notification process completed");
})();
