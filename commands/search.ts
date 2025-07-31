import { formatSearchResult } from "../utils/formatSearchResult.ts";
import TelegramBot from "node-telegram-bot-api";
import {
  callJORFSearchPeople,
  cleanPeopleName
} from "../utils/JORFSearch.utils.ts";
import { IPeople, ISession } from "../types.ts";
import { Types } from "mongoose";
import User from "../models/User.ts";
import People from "../models/People.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

export const searchCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/search" });

  const tgSession: TelegramSession | undefined = await extractTelegramSession(
    session,
    false
  );
  if (tgSession == null) {
    await session.sendMessage(
      'Utilisez la fonction recherche à l\'aide de la commande suivante:\nEx: "Rechercher Emmanuel Macron"',
      session.mainMenuKeyboard
    );
    return;
  }

  const tgBot = tgSession.telegramBot;

  await session.sendTypingAction();
  const question = await tgBot.sendMessage(
    session.chatId,
    "Entrez le prénom et nom de la personne que vous souhaitez rechercher:",
    {
      reply_markup: {
        force_reply: true
      }
    }
  );
  tgBot.onReplyToMessage(
    session.chatId,
    question.message_id,
    (tgMsg: TelegramBot.Message) => {
      void (async () => {
        if (tgMsg.text == undefined || tgMsg.text.length == 0) {
          await session.sendMessage(
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            session.mainMenuKeyboard
          );
          return;
        }
        await searchPersonHistory(session, tgMsg.text, "latest");
      })();
    }
  );
};

export const fullHistoryCommand = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/history" });

  if (msg == undefined) {
    console.log("/history command called without msg argument");
    return;
  }

  const personName = msg.split(" ").slice(1).join(" ");

  if (personName.length == 0) {
    await session.sendMessage("Saisie incorrecte. Veuillez réessayer.", [
      [{ text: "🔎 Nouvelle recherche" }],
      [{ text: "🏠 Menu principal" }]
    ]);
    return;
  }
  await searchPersonHistory(session, personName, "full");
};

async function searchPersonHistory(
  session: ISession,
  personName: string,
  historyType: "full" | "latest"
) {
  try {
    const JORFRes_data = await callJORFSearchPeople(personName);
    const nbRecords = JORFRes_data.length;

    if (nbRecords == 0) {
      const personNameSplit = personName.split(" ");
      if (personNameSplit.length < 2) {
        // Minimum is two words: Prénom + Nom
        await session.sendMessage("Votre saisie est incorrecte.", [
          [{ text: "🔎 Nouvelle recherche" }],
          [{ text: "🏠 Menu principal" }]
        ]);
        return;
      }

      await session.sendMessage(
        "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement !\n\nSi votre saisie est correcte, il est possible que la personne ne soit pas encore apparue au JO.",
        [
          [{ text: "🔎 Nouvelle recherche" }],
          [{ text: `🕵️ Forcer le suivi de ${cleanPeopleName(personName)}` }],
          [{ text: "🏠 Menu principal" }]
        ]
      );
      return;
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(JORFRes_data.slice(0, 2), {
        isConfirmation: true
      });
    } else {
      text += formatSearchResult(JORFRes_data);
    }

    // Check if the user has an account and follows the person
    let isUserFollowingPerson: boolean | null;
    if (session.user == null) {
      isUserFollowingPerson = false;
    } else {
      const people: IPeople | null = await People.findOne({
        nom: { $regex: `^${JORFRes_data[0].nom}$`, $options: "i" }, // regex makes the search case-insensitive
        prenom: { $regex: `^${JORFRes_data[0].prenom}$`, $options: "i" }
      });
      isUserFollowingPerson = !(
        people === null ||
        !isPersonAlreadyFollowed(people, session.user.followedPeople)
      );
    }

    let temp_keyboard: { text: string }[][] | null;
    if (nbRecords <= 2 && isUserFollowingPerson) {
      temp_keyboard = [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: "🏠 Menu principal" }]
      ];
    } else {
      temp_keyboard = [
        [{ text: "🏠 Menu principal" }, { text: "🔎 Nouvelle recherche" }]
      ];
      if (historyType === "latest" && nbRecords > 2) {
        text += `${String(nbRecords - 2)} autres mentions au JORF non affichées.\n\n`;
        temp_keyboard.unshift([
          {
            text: `Historique ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`
          }
        ]);
      }
      if (!isUserFollowingPerson) {
        temp_keyboard.unshift([
          {
            text: `Suivre ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`
          }
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

export const followCommand = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/follow" });

  if (msg == undefined) {
    console.log("/follow command called without msg argument");
    return;
  }

  try {
    const personName = msg.split(" ").slice(1).join(" ");

    if (personName.length == 0) {
      await session.sendMessage(
        "Saisie incorrecte. Veuillez réessayer.",
        session.mainMenuKeyboard
      );
      return;
    }

    await session.sendTypingAction();

    const user = await User.findOrCreate(session);

    const JORFRes = await callJORFSearchPeople(personName);
    if (JORFRes.length == 0) {
      await session.sendMessage(
        "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement",
        session.mainMenuKeyboard
      );
      return;
    }

    const people = await People.firstOrCreate({
      nom: JORFRes[0].nom,
      prenom: JORFRes[0].prenom
    });
    await people.save();

    if (!isPersonAlreadyFollowed(people, user.followedPeople)) {
      user.followedPeople.push({
        peopleId: people._id,
        lastUpdate: new Date(Date.now())
      });
      await user.save();
      await new Promise((resolve) => setTimeout(resolve, 500));
      await session.sendMessage(
        `Vous suivez maintenant *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
        [[{ text: "🔎 Nouvelle recherche" }], [{ text: "🏠 Menu principal" }]]
      );
    } else {
      // With the search/follow flow this would happen only if the user types the "Suivre **" manually
      await new Promise((resolve) => setTimeout(resolve, 500));
      await session.sendMessage(
        `Vous suivez déjà *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`,
        [[{ text: "🔎 Nouvelle recherche" }], [{ text: "🏠 Menu principal" }]]
      );
    }
  } catch (error) {
    console.log(error);
  }
};

export const manualFollowCommand = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/follow-name" });

  if (msg == undefined) {
    console.log("/follow-name command called without msg argument");
    return;
  }

  const tgSession: TelegramSession | undefined = await extractTelegramSession(
    session,
    true
  );
  if (tgSession == null) return;

  const tgBot = tgSession.telegramBot;

  const personNameSplit = cleanPeopleName(msg).split(" ").slice(5);

  // Command is
  const prenomNom = personNameSplit.join(" ");
  const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

  if (session.user?.checkFollowedName(nomPrenom)) {
    await session.sendMessage(
      `Vous suivez déjà *${prenomNom}* (ou orthographe alternative prise en compte) ✅`,
      session.mainMenuKeyboard
    );
    return;
  }

  await session.sendTypingAction();
  const question = await tgBot.sendMessage(
    session.chatId,
    `Voulez-vous forcer le suivi de *${prenomNom}* ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *en cas de variation d'orthographe ou de nom (mariage, divorce), il est possible que les nominations futures ne soient pas notifiées*`,
    {
      reply_markup: {
        force_reply: true
      },
      parse_mode: "Markdown"
    }
  );

  tgBot.onReplyToMessage(
    session.chatId,
    question.message_id,
    (tgMsg2: TelegramBot.Message) => {
      void (async () => {
        if (tgMsg2.text === undefined) {
          await session.sendMessage(
            `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
            session.mainMenuKeyboard
          );
          return;
        }
        if (new RegExp(/oui/i).test(tgMsg2.text)) {
          session.user = await User.findOrCreate(session);
          await session.user.addFollowedName(nomPrenom);
          await session.sendMessage(
            `Le suivi manuel a été ajouté à votre profil en tant que *${nomPrenom}* ✅`
          );
          return;
        } else if (new RegExp(/non/i).test(tgMsg2.text)) {
          await session.sendMessage(
            `Ok, aucun ajout n'a été effectué. 👌`,
            session.mainMenuKeyboard
          );
          return;
        }
        await session.sendMessage(
          `Votre réponse n'a pas été reconnue. 👎 Veuillez essayer de nouveau la commande /search.`,
          session.mainMenuKeyboard
        );
      })();
    }
  );
};
