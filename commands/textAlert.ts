import User from "../models/User.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";
import { ISession } from "../types.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";

const TEXT_ALERT_PROMPT =
  "Quel texte souhaitez-vous surveiller ? Renseignez un mot ou une expression.";

async function askTextAlertQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(session, TEXT_ALERT_PROMPT, handleTextAlertAnswer, {
    messageOptions: { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
  });
}

async function handleTextAlertAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      "Votre texte n'a pas été reconnu. Merci d'entrer un mot ou une expression.",
      { keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]] }
    );
    await askTextAlertQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  session.user ??= await User.findOrCreate(session);

  const wasAdded = await session.user.addFollowedAlertString(trimmedAnswer);
  const responseText = wasAdded
    ? `Alerte enregistrée pour « ${trimmedAnswer} » ✅`
    : `Vous suivez déjà une alerte pour « ${trimmedAnswer} ». ✅`;

  await session.sendMessage(responseText, {
    keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
  });

  return true;
}

export const textAlertCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/text-alert" });
  try {
    await session.sendTypingAction();
    await askTextAlertQuestion(session);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};
