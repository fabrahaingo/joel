import User from "../models/User.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import TelegramBot from "node-telegram-bot-api";
import { ISession } from "../types.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import { parseIntAnswers } from "../utils/text.utils.ts";

const functionTagValues = Object.values(FunctionTags);
const functionTagKeys = Object.keys(FunctionTags);

export const followFunctionCommand = async (
  session: ISession
): Promise<void> => {
  await session.log({ event: "/follow-function" });
  try {
    switch (session.messageApp) {
      case "Telegram": {
        const tgSession: TelegramSession | undefined =
          await extractTelegramSession(session, true);
        if (tgSession == null) return;
        await followFunctionCommandTelegram(tgSession);
        return;
      }

      case "WhatsApp":
        await followFunctionCommandWH(session);
        return;

      default:
        await session.sendMessage("Votre session n'est pas supportée");
    }
  } catch (error) {
    console.log(error);
  }
};

const followFunctionCommandWH = async (session: ISession): Promise<void> => {
  try {
    await session.sendTypingAction();

    const functionChoices: ButtonElement[][] = [];

    for (const key in FunctionTags) {
      let buttonText = "";
      const fctIndex = functionTagKeys.indexOf(key);
      const fctValue = functionTagValues[fctIndex];

      buttonText += `SuivreF ${key}`;

      if (session.user?.followedFunctions.includes(fctValue))
        buttonText += " - Followed";

      functionChoices.push([
        { text: "Ajouter suivi", desc: buttonText.slice(0, 71) }
      ]);
    }

    await session.sendMessage(
      "Choisissez une fonction à ajouter",
      functionChoices,
      "List"
    );
  } catch (error) {
    console.log(error);
  }
};

const followFunctionCommandTelegram = async (
  tgSession: TelegramSession
): Promise<void> => {
  try {
    const tgBot = tgSession.telegramBot;

    await tgSession.sendTypingAction();

    let functionListMessage = "";
    for (const key in FunctionTags) {
      const fctIndex = functionTagKeys.indexOf(key);
      const fctValue = functionTagValues[fctIndex];

      functionListMessage += `${String(
        // number in the array of keys
        fctIndex + 1
      )}. *${key}*`;

      if (tgSession.user?.followedFunctions.includes(fctValue))
        functionListMessage += " - Followed";

      functionListMessage += "\n\n";
    }

    await tgSession.sendMessage(
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${functionListMessage}`
    );
    const question = await tgBot.sendMessage(
      tgSession.chatId,
      "Entrez le(s) nombre(s) correspondant aux fonctions à suivre.\nExemple: 1 4 7",
      {
        reply_markup: {
          force_reply: true
        }
      }
    );

    tgBot.onReplyToMessage(
      tgSession.chatId,
      question.message_id,
      (tgMsg: TelegramBot.Message) => {
        void (async () => {
          const answers = parseIntAnswers(tgMsg.text, functionTagValues.length);
          if (answers === null || answers.length == 0) {
            await tgSession.sendMessage(
              `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(functionTagValues.length)}.
        👎 Veuillez essayer de nouveau la commande /followFunction.`,
              tgSession.mainMenuKeyboard
            );
            return;
          }

          const functionsSelected: (keyof typeof FunctionTags)[] = [];

          for (const answer of answers) {
            functionsSelected.push(functionTagValues[answer - 1]);
          }

          await followFunctionsCommand(tgSession, functionsSelected);
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};

const followFunctionsCommand = async (
  session: ISession,
  functions: (keyof typeof FunctionTags)[]
): Promise<void> => {
  try {
    await session.sendTypingAction();

    const user = await User.findOrCreate(session);

    const addedFunctions: (typeof FunctionTags)[] = [];
    const alreadyFollowedFunctions: (typeof FunctionTags)[] = [];

    for (const functionToFollow of functions) {
      const fctIndex = functionTagValues.indexOf(functionToFollow);
      const fctValue = functionTagKeys[fctIndex];
      if (await user.addFollowedFunction(functionToFollow)) {
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

    await session.sendMessage(text, session.mainMenuKeyboard);
  } catch (error) {
    console.log(error);
  }
};

export const followFunctionFromStrCommand = async (
  session: ISession,
  msg: string
): Promise<void> => {
  try {
    const fctValue = msg.split(" ").slice(1).join(" ");

    let fctIndex = functionTagValues.findIndex(
      (s: string) => s.toLowerCase() === fctValue.toLowerCase()
    );

    if (fctIndex == -1)
      fctIndex = functionTagKeys.findIndex(
        (s: string) => s.toLowerCase() === fctValue.toLowerCase()
      );

    if (fctIndex == -1) {
      await session.sendMessage("La fonction demandée n'est pas reconnue.");
      return;
    }

    await followFunctionsCommand(session, [functionTagValues[fctIndex]]);
  } catch (error) {
    console.log(error);
  }
};
