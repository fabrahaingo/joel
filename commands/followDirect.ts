import { startKeyboard } from "../utils/keyboards";
import People from "../models/People";
import User from "../models/User";
import get from "axios";
import umami from "../utils/umami";
import TelegramBot from "node-telegram-bot-api";
import { Types } from "mongoose";
import { IPeople } from "../types";

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

    let JORFRes = await get(
      encodeURI(
        `https://jorfsearch.steinertriples.ch/name/${person}?format=JSON`
      )
    ).then(async (res) => {
      if (res.data?.length === 0) {
        return res;
      }
      if (res.request.res.responseUrl) {
        return await get(
          res.request.res.responseUrl.endsWith("?format=JSON")
            ? res.request.res.responseUrl
            : `${res.request.res.responseUrl}?format=JSON`
        );
      }
    });

    if (
      JORFRes?.data?.length === 0 ||
      !JORFRes?.data[0]?.nom ||
      !JORFRes.data[0]?.prenom
    ) {
      await bot.sendMessage(
        chatId,
        "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
        startKeyboard
      );
    } else {
      const people = await People.firstOrCreate({
        nom: JORFRes.data[0].nom,
        prenom: JORFRes.data[0].prenom,
        lastKnownPosition: JORFRes.data[0],
      });
      await people.save();
      const tgUser: TelegramBot.User | undefined = msg.from;
      let user = await User.firstOrCreate({
        tgUser,
        chatId,
      });

      if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
        user.followedPeople.push({
          peopleId: people._id,
          lastUpdate: new Date(Date.now()),
        });
        await user.save();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
            chatId,
            `Vous suivez maintenant *${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}* ✅`,
            startKeyboard
        );
      } else {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await bot.sendMessage(
            chatId,
            `Vous suivez déjà *${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}* ✅`,
            startKeyboard
        );
      }
    }
  } catch (error) {
    console.log(error);
  }
};
