import { formatSearchResult } from "../utils/formatSearchResult.ts";
import {
  callJORFSearchPeople,
  cleanPeopleName
} from "../utils/JORFSearch.utils.ts";
import { IPeople, ISession } from "../types.ts";
import { Types } from "mongoose";
import User from "../models/User.ts";
import People from "../models/People.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import { removeSpecialCharacters } from "../utils/text.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

const isPersonAlreadyFollowed = (
  person: IPeople,
  followedPeople: { peopleId: Types.ObjectId; lastUpdate: Date }[]
) => {
  return followedPeople.some((followedPerson) => {
    return followedPerson.peopleId.toString() === person._id.toString();
  });
};

const SEARCH_PROMPT_TEXT =
  "Entrez le prénom et nom de la personne que vous souhaitez rechercher:";

const SEARCH_PROMPT_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

async function askSearchQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(session, SEARCH_PROMPT_TEXT, handleSearchAnswer, {
    messageOptions: {
      keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
    }
  });
}

async function handleSearchAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\n\nVeuillez essayer de nouveau la commande.`,
      { keyboard: SEARCH_PROMPT_KEYBOARD }
    );
    await askSearchQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (trimmedAnswer.split(" ").length < 2) {
    await session.sendMessage(
      "Saisie incorrecte. Veuillez réessayer:\nFormat : *Prénom Nom*",
      { keyboard: SEARCH_PROMPT_KEYBOARD }
    );
    return true;
  }

  await session.sendTypingAction();
  const searchSucceeded = await searchPersonHistory(
    session,
    "Historique " + trimmedAnswer,
    "latest"
  );

  if (!searchSucceeded) {
    await askSearchQuestion(session);
  }

  return true;
}

export const searchCommand = async (session: ISession): Promise<void> => {
  await session.log({ event: "/search" });
  await askSearchQuestion(session);
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
      { keyboard: SEARCH_PROMPT_KEYBOARD }
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
    const personName = message.split(" ").slice(1).join(" ");

    let JORFRes_data: JORFSearchItem[] = [];
    if (!noSearch) JORFRes_data = await callJORFSearchPeople(personName);
    const nbRecords = JORFRes_data.length;

    const tempKeyboard: Keyboard = [];

    if (nbRecords == 0) {
      const personNameSplit = personName.split(" ");
      if (personNameSplit.length < 2) {
        // Minimum is two words: Prénom + Nom
        await session.sendMessage(
          "Saisie incorrecte. Veuillez réessayer:\nFormat : *Rechercher Prénom Nom*",
          { keyboard: tempKeyboard }
        );
        return false;
      }
      const prenomNom = personNameSplit.join(" ");
      const nomPrenom = `${personNameSplit.slice(1).join(" ")} ${personNameSplit[0]}`;

      if (session.user?.checkFollowedName(nomPrenom)) {
        const text = `Vous suivez manuellement *${prenomNom}* ✅`;
        await session.sendMessage(text);
        return false;
      }

      const text = `*${personName}* est introuvable au JO !\n\nAssurez vous d'avoir bien tapé le prénom et le nom correctement !\n\nSi votre saisie est correcte, il est possible que la personne ne soit pas encore apparue au JO.\n\nUtilisez le bouton ci-dessous pour forcer le suivi sur les nominations à venir.`;

      tempKeyboard.unshift([KEYBOARD_KEYS.FOLLOW_UP_FOLLOW_MANUAL.key]);

      await askFollowUpQuestion(session, text, handleSearchFollowUp, {
        context: {
          prenomNom
        },
        messageOptions: {
          keyboard: tempKeyboard
        }
      });
      return false;
    }
    const peopleFromDB: IPeople | null = await People.findOne({
      nom: JORFRes_data[0].nom,
      prenom: JORFRes_data[0].prenom
    });
    let numberFollowers: number | undefined;
    if (peopleFromDB != null) {
      numberFollowers = await User.countDocuments({
        followedPeople: { $elemMatch: { peopleId: peopleFromDB._id } }
      });
    }

    let text = "";
    if (historyType === "latest") {
      text += formatSearchResult(
        JORFRes_data.slice(0, 2),
        session.messageApp !== "WhatsApp",
        {
          isConfirmation: true,
          numberUserFollowing: numberFollowers
        }
      );
    } else {
      text += formatSearchResult(
        JORFRes_data,
        session.messageApp !== "WhatsApp",
        {
          numberUserFollowing: numberFollowers
        }
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

    if (nbRecords > 2 || !isUserFollowingPerson) {
      if (historyType === "latest" && nbRecords > 2) {
        text += `\n${String(nbRecords - 2)} autres mentions au JORF non affichées.\n`;
        if (session.messageApp === "Signal")
          text += `\nPour voir l'historique complet, utilisez la commande: *Historique ${prenomNom}*.\n`;

        tempKeyboard.push([KEYBOARD_KEYS.FOLLOW_UP_HISTORY.key]);
      }
      if (!isUserFollowingPerson) {
        tempKeyboard.unshift([KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key]);
      }
    }

    if (!fromFollow) {
      if (isUserFollowingPerson) {
        text += `\nVous suivez *${prenomNom}* ✅`;
      } else {
        text += `\nVous ne suivez pas *${prenomNom}* 🙅‍♂️\n\n`;
        if (session.messageApp === "Signal")
          text += `Pour suivre, utilisez la commande:\n*Suivre ${prenomNom}*`;
      }
    }
    if (tempKeyboard.length < 2)
      tempKeyboard.push([KEYBOARD_KEYS.PEOPLE_SEARCH_NEW.key]);
    tempKeyboard.push([KEYBOARD_KEYS.MAIN_MENU.key]);

    await askFollowUpQuestion(session, text, handleSearchFollowUp, {
      context: {
        prenomNom
      },
      messageOptions: {
        keyboard: tempKeyboard
      }
    });

    return true;
  } catch (error) {
    console.log(error);
  }
  return false;
}

interface SearchFollowUpContext {
  prenomNom: string;
}

async function handleSearchFollowUp(
  session: ISession,
  answer: string,
  context: SearchFollowUpContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  switch (trimmedAnswer) {
    case KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text:
      await followCommand(session, "Suivre " + context.prenomNom);
      return true;
    case KEYBOARD_KEYS.FOLLOW_UP_HISTORY.key.text:
      await searchPersonHistory(
        session,
        "Historique " + context.prenomNom,
        "full"
      );
      return true;
    case KEYBOARD_KEYS.FOLLOW_UP_FOLLOW_MANUAL.key.text:
      await manualFollowCommand(session, "SuivreN " + context.prenomNom);
      return true;
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

    await session.sendMessage(text, { keyboard: SEARCH_PROMPT_KEYBOARD });
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
