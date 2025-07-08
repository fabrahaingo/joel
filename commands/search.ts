import { formatSearchResult } from "../utils/formatSearchResult.js";
import TelegramBot from "node-telegram-bot-api";
import { callJORFSearchPeople } from "../utils/JORFSearch.utils.js";
import { IPeople, ISession } from "../types.js";
import { Types } from "mongoose";
import User from "../models/User.js";
import People from "../models/People.js";
import { extractTelegramSession, TelegramSession } from "../entities/TelegramSession.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[],
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

export const searchCommand = async (session: ISession, _msg: never): Promise<void> => {
    await session.log({ event: "/search" });

    const tgSession: TelegramSession | undefined = await extractTelegramSession(session, true);
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    await session.sendTypingAction();
    const question = await tgBot.sendMessage(
      session.chatId,
      "Entrez le prénom et nom de la personne que vous souhaitez rechercher:",
      {
        reply_markup: {
          force_reply: true,
        },
      },
    );
    tgBot.onReplyToMessage(
      session.chatId,
      question.message_id,
      async (tgMsg: TelegramBot.Message) => {
        if (tgMsg.text == undefined || tgMsg.text.length == 0) {
          await session.sendMessage(
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            mainMenuKeyboard);
          return;
        }
        await searchPersonHistory(session, tgMsg.text, "latest");
      },
    );
  };

export const fullHistoryCommand  = async (session: ISession, msg: string): Promise<void> => {
    await session.log({ event: "/history" });

    const personName = msg.split(" ").slice(2).join(" ");

    if (personName.length == 0) {
      await session.sendMessage(
        "Saisie incorrecte. Veuillez réessayer.",
          [
              [{ text: "🔎 Nouvelle recherche" }],
              [{ text: "🏠 Menu principal" }]
      ]
      );
      return;
    }
    await searchPersonHistory(session, personName, "full");
  };

async function searchPersonHistory(
  session: ISession,
  personName: string,
  historyType: "full" | "latest",
) {
  try {
    const JORFRes_data = await callJORFSearchPeople(personName);
    const nbRecords = JORFRes_data.length;

    if (nbRecords == 0) {
      await session.sendMessage(
        "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement",
          [
              [{ text: "🔎 Nouvelle recherche" }],
              [{ text: "🏠 Menu principal" }],
          ]);
      return;
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(JORFRes_data.slice(0, 2), {
        isConfirmation: true,
      });
    } else {
      text += formatSearchResult(JORFRes_data);
    }

    // Check if the user has an account and follows the person
    let isUserFollowingPerson: boolean | null;
    if (session.user == null) {
      isUserFollowingPerson = false;
    } else {
      const people: IPeople = await People.findOne({
        nom: JORFRes_data[0].nom,
        prenom: JORFRes_data[0].prenom,
      });
      isUserFollowingPerson = !(
        people === null || !isPersonAlreadyFollowed(people, session.user.followedPeople)
      );
    }

    let temp_keyboard: { text: string }[][] | null;
    if (nbRecords <= 2 && isUserFollowingPerson) {
      temp_keyboard = [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: "🏠 Menu principal" }],
      ];
    } else {
      temp_keyboard = [
        [{ text: "🏠 Menu principal" }, { text: "🔎 Nouvelle recherche" }],
      ];
      if (historyType === "latest" && nbRecords > 2) {
        text += `${String(nbRecords - 2)} autres mentions au JORF non affichées.\n\n`;
        temp_keyboard.unshift([
          {
            text: `Historique de ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`,
          },
        ]);
      }
      if (!isUserFollowingPerson) {
        temp_keyboard.unshift([
          {
            text: `Suivre ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`,
          },
        ]);
      }
    }

    if (isUserFollowingPerson) {
      text += `Vous suivez *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* ✅`;
    } else {
      text += `Vous ne suivez pas *${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}* 🙅‍♂️`;
    }
    await session.sendMessage(text, temp_keyboard);
  } catch (error) {
    console.log(error);
  }
}

export const followCommand= async (session: ISession, msg: string): Promise<void> => {
    await session.log({ event: "/follow" });

    try {
        const personName = msg.split(" ").slice(1).join(" ");

        if (personName.length == 0) {
          await session.sendMessage(
            "Saisie incorrecte. Veuillez réessayer.",
            mainMenuKeyboard,
          );
          return;
        }

      await session.sendTypingAction();

      const user = await User.findOrCreate(session);

      const JORFRes = await callJORFSearchPeople(personName);
      if (JORFRes.length == 0) {
        await session.sendMessage(
          "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
          mainMenuKeyboard,
        );
        return;
      }

      const people = await People.firstOrCreate({
        nom: JORFRes[0].nom,
        prenom: JORFRes[0].prenom,
      });
      await people.save();

      if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
        user.followedPeople.push({
          peopleId: people._id,
          lastUpdate: new Date(Date.now()),
        });
        await user.save();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await session.sendMessage(
          `Vous suivez maintenant *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          [
            [{ text: "🔎 Nouvelle recherche" }],
            [{ text: "🏠 Menu principal" }],
          ],
        );
      } else {
        // With the search/follow flow this would happen only if the user types the "Suivre **" manually
        await new Promise((resolve) => setTimeout(resolve, 500));
        await session.sendMessage(
          `Vous suivez déjà *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
          [
            [{ text: "🔎 Nouvelle recherche" }],
            [{ text: "🏠 Menu principal" }],
          ],
        );
      }
    } catch (error) {
      console.log(error);
    }
  };
