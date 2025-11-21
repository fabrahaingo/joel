import User from "../models/User.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { ISession } from "../types.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

const functionTagValues = Object.values(FunctionTags);
const functionTagKeys = Object.keys(FunctionTags);

const FUNCTION_PROMPT_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

function formatFunctionList(session: ISession): string {
  let functionListMessage = "";
  for (const key in FunctionTags) {
    const fctIndex = functionTagKeys.indexOf(key);
    const fctValue = functionTagValues[fctIndex];

    functionListMessage += `${String(fctIndex + 1)}. *${key}*`;

    if (
      session.user?.followedFunctions
        .map((f) => f.functionTag)
        .includes(fctValue)
    )
      functionListMessage += " - Suivi";

    functionListMessage += "\n";
  }
  return functionListMessage;
}

async function askFunctionQuestion(session: ISession): Promise<void> {
  const promptText =
    "Entrez le(s) nombre(s) correspondant aux fonctions à suivre.\nExemple: 1 4 7";

  await askFollowUpQuestion(session, promptText, handleFunctionAnswer, {
    messageOptions: {
      keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
    }
  });
}

async function handleFunctionAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(functionTagValues.length)}. 👎 Veuillez essayer de nouveau la commande.`,
      { keyboard: FUNCTION_PROMPT_KEYBOARD }
    );
    await askFunctionQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  const selectedFunctions = parseFunctionSelection(trimmedAnswer);

  if (selectedFunctions.length === 0) {
    await session.sendMessage(
      `La fonction demandée n'est pas reconnue. 👎 Veuillez essayer de nouveau la commande.`,
      { keyboard: FUNCTION_PROMPT_KEYBOARD }
    );
    await askFunctionQuestion(session);
    return true;
  }

  await followFunctionsCommand(session, selectedFunctions);
  return true;
}

function parseFunctionSelection(selectionText: string): FunctionTags[] {
  const selectedFunctions: FunctionTags[] = [];

  const textValues = selectionText.split(" ");
  const selectionTexts = textValues.join(" ");

  const answersInt = parseIntAnswers(selectionTexts, functionTagValues.length);

  answersInt.forEach((i) => {
    if (i > 0 && i <= functionTagValues.length) {
      selectedFunctions.push(functionTagValues[i - 1]);
    }
  });

  for (const fctValue of textValues) {
    let fctIndex = functionTagValues.findIndex(
      (s: string) => s.toLowerCase() === fctValue.toLowerCase()
    );

    if (fctIndex == -1)
      fctIndex = functionTagKeys.findIndex(
        (s: string) => s.toLowerCase() === fctValue.toLowerCase()
      );

    if (fctIndex != -1) selectedFunctions.push(functionTagValues[fctIndex]);
  }

  return selectedFunctions.reduce((tab: FunctionTags[], fct) => {
    if (tab.includes(fct)) return tab;
    return [...tab, fct];
  }, []);
}

export const followFunctionCommand = async (
  session: ISession
): Promise<void> => {
  await session.log({ event: "/follow-function" });
  try {
    await session.sendTypingAction();

    await session.sendMessage(
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${formatFunctionList(
        session
      )}`,
      { forceNoKeyboard: true }
    );

    await askFunctionQuestion(session);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};

const followFunctionsCommand = async (
  session: ISession,
  functions: FunctionTags[]
): Promise<void> => {
  try {
    if (functions.length == 0) return;
    await session.sendTypingAction();

    session.user ??= await User.findOrCreate(session);

    const addedFunctions: (keyof typeof FunctionTags)[] = [];
    const alreadyFollowedFunctions: (keyof typeof FunctionTags)[] = [];

    for (const functionToFollow of functions) {
      const fctIndex = functionTagValues.indexOf(functionToFollow);
      const fctValue = functionTagKeys[fctIndex] as keyof typeof FunctionTags;
      if (await session.user.addFollowedFunction(functionToFollow)) {
        addedFunctions.push(fctValue);
      } else {
        alreadyFollowedFunctions.push(fctValue);
      }
    }

    let text = "";

    if (addedFunctions.length == 1) {
      text += `Vous suivez maintenant la fonction *${addedFunctions[0] as string}* ✅`;
    } else if (addedFunctions.length > 1) {
      text += `Vous suivez maintenant les fonctions: ✅\n${addedFunctions
        .map((fct) => `\n   - *${fct as string}*`)
        .join("\n")}`;
    }

    if (addedFunctions.length > 0 && alreadyFollowedFunctions.length > 0)
      text += "\n\n";

    if (alreadyFollowedFunctions.length == 1) {
      text += `Vous suivez déjà la fonction *${alreadyFollowedFunctions[0] as string}* ✅`;
    } else if (alreadyFollowedFunctions.length > 1) {
      text += `Vous suivez déjà les fonctions: ✅\n${alreadyFollowedFunctions
        .map((fct) => `\n   - *${fct as string}*`)
        .join("\n")}`;
    }

    await session.sendMessage(text);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};

export const followFunctionFromStrCommand = async (
  session: ISession,
  msg: string
): Promise<void> => {
  try {
    if (msg.trim().split(" ").length < 2) {
      await followFunctionCommand(session);
      return;
    }

    const selectedFunctions = parseFunctionSelection(
      msg.split(" ").slice(1).join(" ")
    );

    if (selectedFunctions.length == 0) {
      await session.sendMessage("La fonction demandée n'est pas reconnue.", {
        keyboard: [
          [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]
      });
      return;
    }

    await followFunctionsCommand(session, selectedFunctions);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};
