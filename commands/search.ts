import axios from "axios";
import {menuKeyboardPattern, startKeyboard} from "../utils/keyboards";
import { formatSearchResult } from "../utils/formatSearchResult";
import { sendLongText } from "../utils/sendLongText";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  try {
    const chatId = msg.chat.id;

    await umami.log({ event: "/search" });

    bot.sendChatAction(chatId, "typing");
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
      if (!msg.text)
        return bot.sendMessage(
            chatId,
            "Veuillez entrer un nom et un prénom valide",
            startKeyboard
        );
      // if msg.text is not a text, return error. This should authorize accents and special characters used in names like an apostrophe or hyphen
      const validText = /^[a-zA-ZÀ-ÿ\s-']+$/.test(msg.text);
      if (!validText) {
        bot.sendMessage(
            chatId,
            "Veuillez entrer un nom et un prénom valide",
            startKeyboard
        );
        return;
      }
      let JORFRes = await axios
          .get(
              `https://jorfsearch.steinertriples.ch/name/${encodeURI(
                  msg.text
              )}?format=JSON`
          )
          .then(async (res) => {
            if (res.data?.length === 0) {
              return res;
            }
            if (res.request.res.responseUrl) {
              let result = await axios.get(
                  res.request.res.responseUrl.endsWith("?format=JSON")
                      ? res.request.res.responseUrl
                      : `${res.request.res.responseUrl}?format=JSON`
              );
              return result;
            }
          })
          .catch((err) => {
            console.log(err);
          });
      if (!JORFRes || !JORFRes.data || !JORFRes.data.length) {
        bot.sendMessage(
            chatId,
            "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
            startKeyboard
        );
      } else {
        let formattedData = formatSearchResult(JORFRes.data);
        const keyboard= JSON.parse(JSON.stringify(menuKeyboardPattern));
        keyboard.unshift([{text: `Suivre ${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}`}]);

        await sendLongText(bot, chatId, formattedData, keyboard);
      }
    });
  } catch (error) {
    console.log(error);
  }
};
