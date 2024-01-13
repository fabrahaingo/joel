const axios = require("axios");
const { startKeyboard } = require("../utils/keyboards");
const { formatSearchResult } = require("../utils/formatSearchResult");
const { sendLongText } = require("../utils/sendLongText");
const { createHash } = require("node:crypto");
const { send } = require("../utils/umami");

module.exports = (bot) => async (msg) => {
  try {
    const chatId = msg.chat.id;

    send("/search", {
      chatId: createHash("sha256").update(chatId.toString()).digest("hex"),
    });

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
    await bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
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
        let nextMessageId = question.message_id + 2;
        let formattedData = formatSearchResult(JORFRes.data);
        sendLongText(bot, chatId, formattedData, { nextMessageId });
      }
    });
  } catch (error) {
    console.log(error);
  }
};
