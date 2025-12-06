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
  const trimmedText = text.trim();
  if (trimmedText === "") return;

  const { beforeProcessing, isReply, errorContext } = options ?? {};
  try {
    const telemetryPromise = umami
      .log({ event: "/message-received", messageApp: session.messageApp })
      .catch(async (telemetryError: unknown) =>
        logError(
          session.messageApp,
          "Error recording inbound telemetry",
          telemetryError
        )
      );

    if (beforeProcessing) await beforeProcessing();

    if (isReply !== undefined) {
      session.isReply = isReply;
    }

    await session.loadUser();

    const updateMetricsPromise =
      session.user != null
        ? session.user.updateInteractionMetrics()
        : undefined;

    await processMessage(session, trimmedText);

    if (updateMetricsPromise) await updateMetricsPromise;

    await telemetryPromise;
  } catch (error) {
    await logError(
      session.messageApp,
      errorContext ?? "Error processing inbound message",
      error
    );
  }
}
