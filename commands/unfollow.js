const { startKeyboard } = require("../utils/keyboards");
const { sendLongText } = require("../utils/sendLongText");
const User = require("../models/User").default;
const People = require("../models/People").default;
const { createHash } = require("node:crypto");
const { send } = require("../utils/umami");

async function isWrongAnswer(chatId, bot, answer, peoples, followedFunctions) {
  if (
    isNaN(answer) ||
    answer > peoples.length + followedFunctions.length ||
    answer < 1
  ) {
    await bot.sendMessage(
      chatId,
      "La réponse donnée n'est pas sous forme de nombre.",
      startKeyboard
    );
    return true;
  }
  return false;
}

function getKeyFromValue(object, value) {
  return Object.keys(object).find((key) => object[key] === value);
}

function sortArrayAlphabetically(array) {
  return array.sort((a, b) => {
    if (a.nom < b.nom) {
      return -1;
    }
    if (a.nom > b.nom) {
      return 1;
    }
    return 0;
  });
}

async function unfollowFunctionAndConfirm(
  bot,
  chatId,
  user,
  functionToUnfollow
) {
  user.followedFunctions = await user.followedFunctions.filter((elem) => {
    return elem !== functionToUnfollow;
  });
  await user.save();
  await bot.sendMessage(
    chatId,
    `Vous ne suivez plus la fonction *${getKeyFromValue(
      functions,
      functionToUnfollow
    )}* 🙅‍♂️`,
    startKeyboard
  );
}

async function unfollowPeopleAndConfirm(bot, chatId, user, peopleToUnfollow) {
  user.followedPeople = await user.followedPeople.filter((elem) => {
    return !elem.peopleId.equals(peopleToUnfollow._id);
  });
  await user.save();
  await bot.sendMessage(
    chatId,
    `Vous ne suivez plus le contact *${peopleToUnfollow.nom} ${peopleToUnfollow.prenom}* 🙅‍♂️`,
    startKeyboard
  );
}

module.exports = (bot) => async (msg) => {
  try {
    const chatId = msg.chat.id;

    await send("/unfollow", {
      chatId: createHash("sha256").update(chatId.toString()).digest("hex"),
    });

    let i = 0;
    let j = 0;
    bot.sendChatAction(chatId, "typing");
    let text = "";
    let user = await User.firstOrCreate({ tgUser: msg.from, chatId });
    let peopleIds = user.followedPeople.map((p) => p.peopleId);
    let peoples = await People.find({ _id: { $in: peopleIds } })
      .collation({ locale: "fr" })
      .sort({ nom: 1 });
    let followedFunctions = sortArrayAlphabetically(user.followedFunctions);
    if (!user || user.length === 0) {
      text =
        "Une erreur s'est produite avec votre profil. Merci d'envoyer /start pour réessayer.";
    } else {
      if (peoples.length === 0 && followedFunctions.length === 0) {
        return bot.sendMessage(
          chatId,
          `Vous ne suivez aucun contact ni fonction pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`,
          startKeyboard
        );
      } else {
        if (followedFunctions.length > 0) {
          text += "Voici les fonctions que vous suivez :\n\n";
          for (i; i < followedFunctions.length; i++) {
            let functionName = getKeyFromValue(functions, followedFunctions[i]);
            text += `${
              i + 1
            }. *${functionName}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
              followedFunctions[i]
            )})\n\n`;
          }
        }
        if (peoples.length > 0) {
          text += "Voici les personnes que vous suivez :\n\n";
          for (j; j < peoples.length; j++) {
            let nomPrenom = `${peoples[j].nom} ${peoples[j].prenom}`;
            text += `${
              j + 1 + i
            }. *${nomPrenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
              nomPrenom
            )})\n\n`;
          }
        }
      }
    }

    await sendLongText(bot, chatId, text, {
      expectsAnswer: true,
      maxLength: 3000,
    });

    const question = await bot.sendMessage(
      chatId,
      "Entrez le nombre correspondant au contact à supprimer",
      startKeyboard
    );

    return await bot.onReplyToMessage(
      chatId,
      question.message_id,
      async (msg) => {
        const userAnswer = parseInt(msg.text);
        if (
          await isWrongAnswer(
            chatId,
            bot,
            userAnswer,
            peoples,
            followedFunctions
          )
        )
          return;
        if (
          followedFunctions.length > 0 &&
          userAnswer <= followedFunctions.length
        ) {
          await unfollowFunctionAndConfirm(
            bot,
            chatId,
            user,
            followedFunctions[userAnswer - 1]
          );
          return;
        }
        await unfollowPeopleAndConfirm(
          bot,
          chatId,
          user,
          peoples[userAnswer - 1 - followedFunctions.length]
        );
        return;
      }
    );
  } catch (error) {
    console.log(error);
  }
};
