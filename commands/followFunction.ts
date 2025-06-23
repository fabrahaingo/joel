import { startKeyboard } from "../utils/keyboards";
import User from "../models/User";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import { FunctionTags } from "../entities/FunctionTags";
import TelegramBot, {
  ChatId,
  Message,
  SendMessageOptions,
} from "node-telegram-bot-api";

// build message string along with its index
function buildSuggestions() {
  let suggestion = "";
  for (let key in FunctionTags) {
    suggestion += `${
      // number in the array of keys
      Object.keys(FunctionTags).indexOf(key) + 1
    }. *${key}*\n\n`;
  }
  return suggestion;
}

async function isWrongAnswer(
  chatId: ChatId,
  bot: {
    sendMessage: (
      arg0: ChatId,
      arg1: string,
      arg2: SendMessageOptions
    ) => Promise<Message>;
  },
  answer: string | undefined
) {
  if (
    isNaN(Number(answer)) ||
    Number(answer) > Object.keys(FunctionTags).length ||
    Number(answer) < 1
  ) {
    await bot.sendMessage(
      chatId,
      "La réponse donnée n'est pas au format numérique. Veuillez réessayer.",
      startKeyboard
    );
    return true;
  }
  return false;
}

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/follow-function" });
  try {
    await bot.sendChatAction(chatId, "typing");
    await sendLongText(
      bot,
      chatId,
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${buildSuggestions()}`
    );
    const question = await bot.sendMessage(
      chatId,
      "Entrez le numéro de la fonction que vous souhaitez suivre:",
      {
        reply_markup: {
          force_reply: true,
        },
      }
    );
    bot.onReplyToMessage(
      chatId,
      question.message_id,
      async (msg: TelegramBot.Message) => {
        if (await isWrongAnswer(chatId, bot, msg.text)) return;
        if (msg.text === undefined) return;

        let answer = parseInt(msg.text);
        const functionToFollow = Object.values(FunctionTags)[answer - 1];
        const functionTag = Object.keys(FunctionTags)[
          answer - 1
        ] as keyof typeof FunctionTags;

          const tgUser: TelegramBot.User | undefined = msg.from;
          if (tgUser === undefined) return;
          const user = await User.firstOrCreate({
              tgUser,
              chatId,
              messageApp: "Telegram"
          });
          if (user === null) return;

        if (await user.addFollowedFunction(functionToFollow)) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            await bot.sendMessage(
                chatId,
                `Vous suivez maintenant la fonction *${functionTag}* ✅`,
                startKeyboard
            );
        } else {
            await new Promise((resolve) => setTimeout(resolve, 300));
            await bot.sendMessage(
                chatId,
                `Vous suivez déjà la fonction *${functionTag}* ✅`,
                startKeyboard
            );
        }
      }
    );
  } catch (error) {
    console.log(error);
  }
};
