import { startKeyboard } from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    const chatId = msg.chat.id;

    await umami.log({ event: "/search" });

    await bot.sendChatAction(chatId, "typing");
    const question = await bot.sendMessage(
      chatId,
      "De quelle personne souhaitez-vous voir l'historique des nominations ?",
      {
        reply_markup: {
          force_reply: true,
        },
      }
    );
    bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      if (msg.text === undefined) {
        await bot.sendMessage(
            chatId,
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            startKeyboard
        );
        return;
      }
      const JORFRes_data = await callJORFSearchPeople(msg.text);
      const formattedData = formatSearchResult(JORFRes_data);
      await sendLongText(bot, chatId, formattedData);
    });
  } catch (error) {
    console.log(error);
  }
};
