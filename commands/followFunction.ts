import User from "../models/User.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import TelegramBot from "node-telegram-bot-api";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { ISession } from "../types";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";

const functionTagValues = Object.values(FunctionTags);
const functionTagKeys = Object.keys(FunctionTags);

export const followFunctionCommand = async (
  session: ISession
): Promise<void> => {
  await session.log({ event: "/follow-function" });
  try {
    await session.sendTypingAction();

    let functionListMessage = "";
    for (const key in FunctionTags) {
      const fctIndex = functionTagKeys.indexOf(key);
      const fctValue = functionTagValues[fctIndex];

      functionListMessage += `${String(
        // number in the array of keys
        fctIndex + 1
      )}. *${key}*`;

      if (
        session.user?.followedFunctions
          .map((f) => f.functionTag)
          .includes(fctValue)
      )
        functionListMessage += " - Followed";

      functionListMessage += "\n\n";
    }

    await session.sendMessage(
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${functionListMessage}`
    );
    let text = "Entrez le(s) nombre(s) correspondant aux fonctions à suivre.\n";

    if (session.messageApp === "Telegram") {
      text += `Exemples: 1 4 7`;

      const tgSession: TelegramSession | undefined =
        await extractTelegramSession(session, true);
      if (tgSession == null) return;
      const tgBot = tgSession.telegramBot;

      const question = await tgBot.sendMessage(tgSession.chatIdTg, text, {
        reply_markup: {
          force_reply: true
        }
      });

      tgBot.onReplyToMessage(
        tgSession.chatId,
        question.message_id,
        (tgMsg: TelegramBot.Message) => {
          void (async () => {
            if (tgMsg.text == undefined || tgMsg.text.length == 0) {
              await tgSession.sendMessage(
                `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(functionTagValues.length)}. 👎 Veuillez essayer de nouveau la commande.`,
                [
                  [KEYBOARD_KEYS.FUNCTION_FOLLOW.key],
                  [KEYBOARD_KEYS.MAIN_MENU.key]
                ]
              );
              return;
            }
            await followFunctionFromStrCommand(
              session,
              "SuivreF " + tgMsg.text
            );
          })();
        }
      );
    } else {
      text += "Exemples: SuivreF 1 4 7";
      await session.sendMessage(text);
    }
  } catch (error) {
    console.log(error);
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

    const selectedFunctions: FunctionTags[] = [];

    const textValues = msg.split(" ").slice(1);

    const selectionTexts = textValues.join(" ");

    const answersInt = parseIntAnswers(
      selectionTexts,
      functionTagValues.length
    );

    answersInt.forEach((i) => {
      selectedFunctions.push(functionTagValues[i - 1]);
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

    const selectedFunctionsUnique = selectedFunctions.reduce(
      (tab: FunctionTags[], fct) => {
        if (tab.includes(fct)) return tab;
        return [...tab, fct];
      },
      []
    );

    if (selectedFunctions.length == 0) {
      await session.sendMessage(
        "La fonction demandée n'est pas reconnue.",
        session.messageApp !== "WhatsApp"
          ? [[KEYBOARD_KEYS.FUNCTION_FOLLOW.key], [KEYBOARD_KEYS.MAIN_MENU.key]]
          : undefined
      );
      return;
    }

    await followFunctionsCommand(session, selectedFunctionsUnique);
  } catch (error) {
    console.log(error);
  }
};
