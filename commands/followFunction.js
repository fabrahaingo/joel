const { startKeyboard } = require("../utils/keyboards");
const User = require("../models/User");
const functionsJSON = require("../json/functionTags.json");
const functions = Object.keys(functionsJSON);
const { sendLongText } = require("../utils/sendLongText");
const { createHash } = require("node:crypto");
const { send } = require("../utils/umami");

// build message string along with its index
function buildSuggestions() {
  let suggestion = "";
  functions.forEach((func, index) => {
    suggestion += `${index + 1}. *${func}*\n\n`;
  });
  return suggestion;
}

function isTagAlreadyFollowed(user, functionToFollow) {
  return user.followedFunctions.some((elem) => {
    return elem === functionToFollow;
  });
}

async function isWrongAnswer(chatId, bot, answer) {
  if (isNaN(answer) || answer > functions.length || answer < 1) {
    await bot.sendMessage(
      chatId,
      "La réponse donnée n'est pas au format numérique. Veuillez réessayer.",
      startKeyboard
    );
    return true;
  }
  return false;
}

module.exports = (bot) => async (msg) => {
  const chatId = msg.chat.id;
  send("/follow-function", {
    chatId: createHash("sha256").update(chatId.toString()).digest("hex"),
  });
  try {
    await bot.sendChatAction(chatId, "typing");
    await sendLongText(
      bot,
      chatId,
      `Voici la liste des fonctions que vous pouvez suivre:\n\n${buildSuggestions()}`,
      {
        keyboard: startKeyboard,
        maxLength: 3000,
        expectsAnswer: true,
      }
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
    await bot.onReplyToMessage(chatId, question.message_id, async (msg) => {
      let answer = parseInt(msg.text);
      if ((await isWrongAnswer(chatId, bot, answer)) === true) return;
      const functionToFollow = functions[answer - 1];
      const functionTag = functionsJSON[functionToFollow];
      const tgUser = msg.from;
      let user = await User.firstOrCreate(tgUser, chatId);
      // only add to followedPeople if user is not already following this person
      if (!isTagAlreadyFollowed(user, functionTag)) {
        user.followedFunctions.push(functionTag);
        await user.save();
      }
      // wait 500 ms before sending the next message
      await new Promise((resolve) => setTimeout(resolve, 500));
      await bot.sendMessage(
        chatId,
        `Vous suivez maintenant la fonction *${functionToFollow}* ✅`,
        startKeyboard
      );
    });
  } catch (error) {
    console.log(error);
  }
};
