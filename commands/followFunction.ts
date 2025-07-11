import User from "../models/User.js";
import { FunctionTags } from "../entities/FunctionTags.js";
import TelegramBot from "node-telegram-bot-api";
import { mainMenuKeyboard } from "../utils/keyboards.js";
import { ISession } from "../types.js";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.js";
import { parseIntAnswers } from "../utils/text.utils.js";

// build the message string along with its index
function buildSuggestions() {
  let suggestion = "";
  for (const key in FunctionTags) {
    suggestion += `${String(
      // number in the array of keys
      Object.keys(FunctionTags).indexOf(key) + 1
    )}. *${key}*\n\n`;
  }
  return suggestion;
}

export const followFunctionCommand = async (
  session: ISession,
  _msg: string
): Promise<void> => {
  await session.log({ event: "/follow-function" });
  try {
    if (session.user == null) {
      await session.sendMessage(
        `Aucun profil utilisateur n'est actuellement associé à votre identifiant ${String(session.chatId)}`,
        mainMenuKeyboard
      );
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    await session.sendTypingAction();
    await session.sendMessage(
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${buildSuggestions()}`
    );
    const question = await tgBot.sendMessage(
      session.chatId,
      "Entrez le(s) nombre(s) correspondant aux fonctions à suivre.\nExemple: 1 4 7",
      {
        reply_markup: {
          force_reply: true
        }
      }
    );

    const functionAll = Object.values(FunctionTags);

    tgBot.onReplyToMessage(
      session.chatId,
      question.message_id,
      (tgMsg: TelegramBot.Message) => {
        void (async () => {
          const answers = parseIntAnswers(tgMsg.text, functionAll.length);
          if (answers === null || answers.length == 0) {
            await session.sendMessage(
              `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(functionAll.length)}.
        👎 Veuillez essayer de nouveau la commande /followFunction.`,
              mainMenuKeyboard
            );
            return;
          }
          await session.sendTypingAction();

          const user = await User.findOrCreate(session);

          const addedFunctions: (keyof typeof FunctionTags)[] = [];
          const alreadyFollowedFunctions: (keyof typeof FunctionTags)[] = [];

          for (const answer of answers) {
            const functionToFollow = Object.values(FunctionTags)[answer - 1];
            const functionTag = Object.keys(FunctionTags)[
              answer - 1
            ] as keyof typeof FunctionTags;

            if (await user.addFollowedFunction(functionToFollow)) {
              addedFunctions.push(functionTag);
            } else {
              alreadyFollowedFunctions.push(functionTag);
            }
          }

          let text = "";

          if (addedFunctions.length == 1) {
            text += `Vous suivez maintenant la fonction *${addedFunctions[0]}* ✅`;
          } else if (addedFunctions.length > 1) {
            text += `Vous suivez maintenant les fonctions: ✅\n${addedFunctions
              .map((fct) => `\n   - *${fct}*`)
              .join("\n")}`;
          }

          if (addedFunctions.length > 0 && alreadyFollowedFunctions.length > 0)
            text += "\n\n";

          if (alreadyFollowedFunctions.length == 1) {
            text += `Vous suivez déjà la fonction *${alreadyFollowedFunctions[0]}* ✅`;
          } else if (alreadyFollowedFunctions.length > 1) {
            text += `Vous suivez déjà les fonctions: ✅\n${alreadyFollowedFunctions
              .map((fct) => `\n   - *${fct}*`)
              .join("\n")}`;
          }

          await session.sendMessage(text, mainMenuKeyboard);
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};
