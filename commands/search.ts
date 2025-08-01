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
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

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
            `Votre réponse n'a pas été reconnue 👎.\n Veuillez essayer de nouveau la commande.`,
            [
              [{ text: "🔎 Nouvelle recherche" }],
              [{ text: "🏠 Menu principal" }]
            ]
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
    await session.sendMessage(
      "Saisie incorrecte. Veuillez réessayer:\nFormat : *Rechercher Prénom Nom*",
      [[{ text: "🔎 Nouvelle recherche" }], [{ text: "🏠 Menu principal" }]]
    );
    return;
  }
  await searchPersonHistory(session, personName, "full");
};

async function searchPersonHistory(
  session: ISession,
  personName: string,
  historyType: "full" | "latest",
  noSearch = false
) {
  try {
    let JORFRes_data: JORFSearchItem[] = [];

    if (!noSearch) JORFRes_data = await callJORFSearchPeople(personName);
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

      let text =
        "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement !\n\nSi votre saisie est correcte, il est possible que la personne ne soit pas encore apparue au JO.";

      const prenomNom = personNameSplit.join(" ");
      const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

      let tgKeyboard = [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: `🕵️ Forcer le suivi de ${prenomNom}` }],
        [{ text: "🏠 Menu principal" }]
      ];
      if (session.user?.checkFollowedName(nomPrenom)) {
        text += `\n\nVous suivez manuellement *${prenomNom}* ✅`;
        tgKeyboard = [
          [{ text: "🔎 Nouvelle recherche" }],
          [{ text: "🏠 Menu principal" }]
        ];
      } else if (session.messageApp !== "Telegram") {
        text += `\n\nPour forcer le suivi manuel, utilisez le commande:\n*SuivreN ${prenomNom}*`;
      }

      if (session.messageApp === "Telegram")
        await session.sendMessage(text, tgKeyboard);
      else await session.sendMessage(text, session.mainMenuKeyboard);
      return;
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(
        JORFRes_data.slice(0, 2),
        session.messageApp === "Telegram",
        {
          isConfirmation: true
        }
      );
    } else {
      text += formatSearchResult(
        JORFRes_data,
        session.messageApp === "Telegram"
      );
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
      text += `\nPour suivre, utilisez la commande:\n*Suivre ${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}*`;
    }
    if (session.messageApp === "Telegram") {
      await session.sendMessage(text, temp_keyboard);
    } else {
      await session.sendMessage(text, session.mainMenuKeyboard);
    }
  } catch (error) {
    console.log(error);
  }
}

export const followCommand = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/follow" });

  const wrongParametersMsg =
    "Saisie incorrecte. Veuillez réessayer:\nFormat : *Suivre Prénom Nom*";

  if (msg == undefined || msg.length == 0) {
    await session.sendMessage(wrongParametersMsg, session.mainMenuKeyboard);
    return;
  }

  try {
    const personName = msg.split(" ").slice(1).join(" ");

    if (personName.length == 0) {
      await session.sendMessage(wrongParametersMsg, session.mainMenuKeyboard);
      return;
    }

    await session.sendTypingAction();

    const JORFRes = await callJORFSearchPeople(personName);
    if (JORFRes.length == 0) {
      // redirect to manual follow
      await searchPersonHistory(session, personName, "latest", true);
      return;
    }

    session.user ??= await User.findOrCreate(session);

    const people = await People.findOrCreate({
      nom: JORFRes[0].nom,
      prenom: JORFRes[0].prenom
    });

    let text = "";
    if (!isPersonAlreadyFollowed(people, session.user.followedPeople)) {
      session.user.followedPeople.push({
        peopleId: people._id,
        lastUpdate: new Date(Date.now())
      });
      await session.user.save();
      text += `Vous suivez maintenant *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`;
    } else {
      // With the search/follow flow this would happen only if the user types the "Suivre **" manually
      text += `Vous suivez déjà *${JORFRes[0].prenom} ${JORFRes[0].nom}* ✅`;
    }
    if (session.messageApp === "Telegram")
      await session.sendMessage(text, [
        [{ text: "🔎 Nouvelle recherche" }],
        [{ text: "🏠 Menu principal" }]
      ]);
    else await session.sendMessage(text, session.mainMenuKeyboard);
  } catch (error) {
    console.log(error);
  }
};

export const manualFollowCommandLong = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await manualFollowCommandShort(session, msg?.split(" ").slice(4).join(" "));
};

export const manualFollowCommandShort = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/follow-name" });

  const personNameSplit = cleanPeopleName(msg ?? "")
    .split(" ")
    .slice(1);

  const prenomNom = personNameSplit.join(" ");
  const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

  if (personNameSplit.length === 0) {
    await session.sendMessage(
      "Saisie incorrecte. Veuillez réessayer:\nFormat : *SuivreN Prénom Nom*",
      session.mainMenuKeyboard
    );
    return;
  }

  if (session.user?.checkFollowedName(nomPrenom)) {
    await session.sendMessage(
      `Vous suivez déjà *${prenomNom}* (ou orthographe alternative prise en compte) ✅`,
      session.mainMenuKeyboard
    );
    return;
  }

  session.user = await User.findOrCreate(session);
  await session.user.addFollowedName(nomPrenom);

  await session.sendMessage(
    `Le suivi manuel a été ajouté à votre profil en tant que *${nomPrenom}* ✅`,
    session.mainMenuKeyboard
  );
};
