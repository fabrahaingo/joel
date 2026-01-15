import { ISession } from "../types.ts";
import { processMessage } from "../commands/Commands.ts";
import { logError } from "./debugLogger.ts";
import { triggerPendingNotifications } from "../commands/triggerPendingNotifications.ts";
import User from "../models/User.ts";

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
  const { beforeProcessing, isReply, errorContext } = options ?? {};
  try {
    const res = await User.updateOne(
      { messageApp: session.messageApp, chatId: session.chatId },
      { $set: { lastEngagementAt: session.lastEngagementAt, status: "active" } }
    );
    session.log({
      event: "/message-received",
      payload: { has_account: res.modifiedCount > 0 }
    });

    if (beforeProcessing) await beforeProcessing();

    if (isReply !== undefined) {
      session.isReply = isReply;
    }
    const trimmedText = text.trim();
    if (trimmedText === "") return;

    session.sendTypingAction();

    const user = await session.loadUser();
    if (user != null && user.pendingNotifications.length > 0) {
      await triggerPendingNotifications(session);
      await user.updateInteractionMetrics();
      return;
    }

    // Detect if this is the first message from this user (no user record exists)
    const isFirstMessage = user == null;

    await processMessage(session, trimmedText, { isFirstMessage });

    if (user != null) await user.updateInteractionMetrics();
  } catch (error) {
    await logError(
      session.messageApp,
      errorContext ?? "Error processing inbound message",
      error
    );
  }
}
