const { sendLongText } = require("../utils/sendLongText");

module.exports = (bot) => async (msg) => {
  const chatId = msg.chat.id;
  try {
    await bot.sendChatAction(chatId, "typing");
    const text = `*Un problème ?*\n\nMerci de contacter @hellofabien ou hellofabien@pm.me en mentionnant votre identifiant Telegram (*${msg.from.id}*)`;
    const msgTemplate = `Identifiant Telegram:\n👉 ${msg.from.id}\n\nDescription de l'erreur: \n👉 `;
    const userMsgLink = `tg://msg?text=${msgTemplate}&to=@hellofabien`;
    const encodedMsg = encodeURI(userMsgLink);
    const nextMsg = msg.message_id + 1;
    await sendLongText(bot, chatId, text, {
      keyboard: {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "📱 Écrire à @hellofabien",
                url: encodedMsg,
              },
            ],
          ],
        },
      },
      nextMsg,
    });
  } catch (error) {
    console.log(error);
  }
};
