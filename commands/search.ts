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
import { removeSpecialCharacters } from "../utils/text.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";

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
      'Utilisez la fonction recherche à l\'aide de la commande suivante:\nEx: "Rechercher Emmanuel Macron"'
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
            `Votre réponse n'a pas été reconnue. 👎\n\nVeuillez essayer de nouveau la commande.`,
            [
              [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
              [KEYBOARD_KEYS.MAIN_MENU.key]
            ]
          );
          return;
        }
        await searchPersonHistory(
          session,
          "Historique " + tgMsg.text,
          "latest"
        );
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
      session.messageApp !== "WhatsApp"
        ? [[KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key], [KEYBOARD_KEYS.MAIN_MENU.key]]
        : undefined
    );
    return;
  }
  await searchPersonHistory(session, "Historique " + personName, "full");
};

// returns whether the person exists
export async function searchPersonHistory(
  session: ISession,
  message: string,
  historyType: "full" | "latest" = "latest",
  noSearch = false,
  fromFollow = false
): Promise<boolean> {
  try {
    if (message.split(" ").length < 2) return false;

    const personName = message.split(" ").slice(1).join(" ");

    let JORFRes_data: JORFSearchItem[] = [];
    if (!noSearch) JORFRes_data = await callJORFSearchPeople(personName);
    const nbRecords = JORFRes_data.length;

    const tempKeyboard: Keyboard = [
      [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ];

    if (nbRecords == 0) {
      const personNameSplit = personName.split(" ");
      if (personNameSplit.length < 2) {
        // Minimum is two words: Prénom + Nom
        await session.sendMessage(
          "Saisie incorrecte. Veuillez réessayer:\nFormat : *Rechercher Prénom Nom*",
          session.messageApp == "Telegram" ? tempKeyboard : undefined
        );
        return false;
      }

      let text =
        "Personne introuvable, assurez vous d'avoir bien tapé le prénom et le nom correctement !\n\nSi votre saisie est correcte, il est possible que la personne ne soit pas encore apparue au JO.";

      const prenomNom = personNameSplit.join(" ");
      const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

      let tgKeyboard = [
        [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
        [{ text: `🕵️ Forcer le suivi de ${prenomNom}` }],
        [KEYBOARD_KEYS.MAIN_MENU.key]
      ];
      if (session.user?.checkFollowedName(nomPrenom)) {
        text += `\n\nVous suivez manuellement *${prenomNom}* ✅`;
        tgKeyboard = tempKeyboard;
      } else if (session.messageApp !== "Telegram") {
        text += `\n\nPour forcer le suivi manuel, utilisez la commande:\n*SuivreN ${prenomNom}*`;
      }

      if (session.messageApp === "Telegram")
        await session.sendMessage(text, tgKeyboard);
      else await session.sendMessage(text);
      return false;
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(
        JORFRes_data.slice(0, 2),
        session.messageApp !== "WhatsApp",
        {
          isConfirmation: true
        }
      );
    } else {
      text += formatSearchResult(
        JORFRes_data,
        session.messageApp !== "WhatsApp"
      );
    }

    // Check if the user has an account and follows the person
    let isUserFollowingPerson: boolean | null;
    if (session.user == null) {
      isUserFollowingPerson = false;
    } else {
      const people: IPeople | null = await People.findOne({
        nom: JORFRes_data[0].nom,
        prenom: JORFRes_data[0].prenom
      })
        .collation({ locale: "fr", strength: 2 }) // case-insensitive, no regex
        .lean();

      isUserFollowingPerson = !(
        people === null ||
        !isPersonAlreadyFollowed(people, session.user.followedPeople)
      );
    }

    const prenomNom = `${JORFRes_data[0].prenom} ${JORFRes_data[0].nom}`;

    let temp_keyboard: Keyboard = tempKeyboard;
    if (nbRecords > 2 || !isUserFollowingPerson) {
      temp_keyboard = [
        [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
        [KEYBOARD_KEYS.MAIN_MENU.key]
      ];
      if (historyType === "latest" && nbRecords > 2) {
        text += `\n${String(nbRecords - 2)} autres mentions au JORF non affichées.\n`;
        if (session.messageApp !== "Telegram")
          text += `\nPour voir l'historique complet, utilisez la commande: *Historique ${prenomNom}*.\n`;

        temp_keyboard.unshift([
          {
            text: `Historique complet de ${prenomNom}`
          }
        ]);
      }
      if (!isUserFollowingPerson) {
        temp_keyboard.unshift([
          {
            text: `Suivre ${prenomNom}`
          }
        ]);
      }
    }

    if (!fromFollow) {
      if (isUserFollowingPerson) {
        text += `\nVous suivez *${prenomNom}* ✅`;
      } else {
        text += `\nVous ne suivez pas *${prenomNom}* 🙅‍♂️\n\n`;
        if (session.messageApp === "WhatsApp")
          text += `Pour suivre, utilisez la commande:\n*Suivre ${prenomNom}*`;
      }
    }
    await session.sendMessage(text, temp_keyboard);
    return true;
  } catch (error) {
    console.log(error);
  }
  return false;
}

export const followCommand = async (
  session: ISession,
  msg: string
): Promise<void> => {
  try {
    await session.log({ event: "/follow" });

    const msgSplit = msg.split(" ");

    if (msgSplit.length < 3) {
      await session.sendMessage(
        "Saisie incorrecte. Veuillez réessayer:\nFormat : *Suivre Prénom Nom*"
      );
      return;
    }

    const personName = msgSplit.slice(1).join(" ");

    await session.sendTypingAction();

    const JORFRes = await callJORFSearchPeople(personName);
    if (JORFRes.length == 0) {
      // redirect to manual follow
      const latestResult = await searchPersonHistory(
        session,
        "Historique " + personName,
        "latest",
        false,
        true
      );
      if (!latestResult) return;
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
        [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
        [KEYBOARD_KEYS.MAIN_MENU.key]
      ]);
    else await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};
export const manualFollowCommand = async (
  session: ISession,
  msg?: string
): Promise<void> => {
  await session.log({ event: "/follow-name" });

  const personNameSplit = cleanPeopleName(
    removeSpecialCharacters(msg ?? "")
      .trim()
      .replaceAll("  ", " ")
  )
    .split(" ")
    .slice(1);

  if (personNameSplit.length < 2) {
    await session.sendMessage(
      "Saisie incorrecte. Veuillez réessayer:\nFormat : *SuivreN Prénom Nom*"
    );
    return;
  }

  const prenomNom = personNameSplit.join(" ");
  const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

  if ((await callJORFSearchPeople(prenomNom)).length > 0) {
    await followCommand(session, "Suivre " + prenomNom);
    return;
  }

  if (session.user?.checkFollowedName(nomPrenom)) {
    await session.sendMessage(
      `Vous suivez déjà *${prenomNom}* (ou orthographe alternative prise en compte) ✅`
    );
    return;
  }

  session.user = await User.findOrCreate(session);
  await session.user.addFollowedName(nomPrenom);

  await session.sendMessage(
    `Le suivi manuel a été ajouté à votre profil en tant que *${nomPrenom}* ✅`
  );
};
