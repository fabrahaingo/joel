import { ISession } from "../types.ts";
import { processMessage } from "../commands/Commands.ts";
import umami from "./umami.ts";
import { logError } from "./debugLogger.ts";

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
    umami.log({
      event: "/message-received",
      messageApp: session.messageApp
    });

    if (beforeProcessing) await beforeProcessing();

    if (isReply !== undefined) {
      session.isReply = isReply;
    }

    await session.loadUser();

    await processMessage(session, trimmedText);

    if (session.user != null) await session.user.updateInteractionMetrics();
  } catch (error) {
    await logError(
      session.messageApp,
      errorContext ?? "Error processing inbound message",
      error
    );
  }
}
