import { startKeyboard } from "../utils/keyboards";
import People from "../models/People";
import User from "../models/User";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { Types } from "mongoose";
import { IPeople } from "../types";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

module.exports = (bot: TelegramBot) => async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  await umami.log({ event: "/follow" });

  const person= msg.text?.split(" ").slice(1).join(" ");

  if (person === undefined || person.length == 0) {
    await bot.sendMessage(
        chatId,
        "Saisie incorrecte. Veuillez réessayer.",
        startKeyboard
    );
    return;
  }

  try {
    await bot.sendChatAction(chatId, "typing");

    const tgUser: TelegramBot.User | undefined = msg.from;
    if (tgUser === undefined) return;
    let user = await User.firstOrCreate({
      tgUser,
      chatId,
    });

    const JORFRes = await callJORFSearchPeople(person);
    if (JORFRes.length == 0) {
      await bot.sendMessage(
          chatId,
          "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
          startKeyboard
      );
      return;
    }

    const people = await People.firstOrCreate({
      nom: JORFRes[0].nom,
      prenom: JORFRes[0].prenom,
      lastKnownPosition: JORFRes[0],
    });
    await people.save();

    if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
      user.followedPeople.push({
        peopleId: people._id,
        lastUpdate: new Date(Date.now()),
      });
      await user.save();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await bot.sendMessage(
          chatId,
          `Vous suivez maintenant *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          startKeyboard
      );
    } else {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await bot.sendMessage(
          chatId,
          `Vous suivez déjà *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          startKeyboard
      );

    }
  } catch (error) {
    console.log(error);
  }
};
