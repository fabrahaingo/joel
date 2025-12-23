import { ISession } from "../types.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "./umami.ts";
import { logError } from "./debugLogger.ts";
import { triggerPendingNotifications } from "../commands/triggerPendingNotifications.ts";

interface MessageWorkflowOptions {
  isReply?: boolean;
  beforeProcessing?: () => Promise<void>;
  errorContext?: string;
}

/**
 * Standardized pipeline for processing a text message across messaging apps.
 * Handles telemetry, user loading, metrics update, and command dispatching.
 */
export async function handleIncomingMessage(
  session: ISession,
  text: string,
  options?: MessageWorkflowOptions
): Promise<void> {
  session.sendTypingAction();
  const trimmedText = text.trim();
  if (trimmedText === "") return;

  const { beforeProcessing, isReply, errorContext } = options ?? {};
  try {
    if (beforeProcessing) await beforeProcessing();

    if (isReply !== undefined) {
      session.isReply = isReply;
    }

    const user = await session.loadUser();

    session.log({
      event: "/message-received"
    });

    if (user != null && user.pendingNotifications.length > 0) {
      await triggerPendingNotifications(session);
    }

    await processMessage(session, trimmedText);

    if (user != null) await user.updateInteractionMetrics();
  } catch (error) {
    await logError(
      session.messageApp,
      errorContext ?? "Error processing inbound message",
      error
    );
  }
}
