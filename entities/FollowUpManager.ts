import { ISession } from "../types.ts";
import { MessageSendingOptionsInternal } from "./Session.ts";

function sessionKey(session: ISession): string {
  return `${session.messageApp}:${session.chatId}`;
}

type FollowUpHandler = (
  session: ISession,
  message: string,
  context: unknown
) => Promise<boolean>;

interface FollowUpRecord {
  handler: FollowUpHandler;
  context: unknown;
  messageOptions?: MessageSendingOptionsInternal;
}

const followUps = new Map<string, FollowUpRecord>();

export function clearFollowUp(session: ISession): void {
  followUps.delete(sessionKey(session));
}

export async function handleFollowUpMessage(
  session: ISession,
  message: string
): Promise<boolean> {
  const key = sessionKey(session);
  const record = followUps.get(key);
  if (record === undefined) {
    return false;
  }

  // Remove existing follow-up before invoking handler to allow chaining.
  followUps.delete(key);
  clearFollowUp(session);

  return await record.handler(session, message, record.context);
}

interface AskFollowUpOptions<Context> {
  context?: Context;
  messageOptions?: MessageSendingOptionsInternal;
}

export async function askFollowUpQuestion<Context = unknown>(
  session: ISession,
  question: string,
  handler: (
    session: ISession,
    message: string,
    context: Context
  ) => Promise<boolean>,
  options: AskFollowUpOptions<Context> = {}
): Promise<boolean> {
  const key = sessionKey(session);
  followUps.set(key, {
    handler: handler as FollowUpHandler,
    context: options.context,
    messageOptions: options.messageOptions
  });

  try {
    if (question !== "") {
      return await session.sendMessage(question, options.messageOptions);
    }
  } catch (error) {
    followUps.delete(key);
    throw error;
  }
  return false;
}

export function hasFollowUp(session: ISession): boolean {
  return followUps.has(sessionKey(session));
}
