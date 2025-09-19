import People from "../models/People.ts";
import {
  FunctionTags,
  getFunctionsFromValues
} from "../entities/FunctionTags.ts";
import { IOrganisation, IPeople, ISession, IUser } from "../types.ts";
import Organisation from "../models/Organisation.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import TelegramBot from "node-telegram-bot-api";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { Types } from "mongoose";
import User from "../models/User.ts";
import {
  getJORFSearchLinkOrganisation,
  getJORFSearchLinkFunctionTag,
  getJORFSearchLinkPeople
} from "../utils/JORFSearch.utils.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";

interface UserFollows {
  functions: FunctionTags[];
  organisations: IOrganisation[];
  peopleAndNames: {
    nomPrenom: string;
    prenomNom?: string;
    peopleId?: Types.ObjectId;
    JORFSearchLink?: string;
  }[];
  meta: never[];
}

const noDataText = `Vous ne suivez aucun contact, fonction, ni organisation pour le moment.`;

async function getAllUserFollowsOrdered(user: IUser): Promise<UserFollows> {
  const followedFunctions = user.followedFunctions.sort((a, b) =>
    a.functionTag.localeCompare(b.functionTag)
  );

  let followedOrganisations: IOrganisation[] = [];
  if (user.followedOrganisations.length > 0)
    followedOrganisations = await Organisation.find({
      wikidataId: { $in: user.followedOrganisations.map((o) => o.wikidataId) }
    }).lean();

  followedOrganisations.sort((a, b) =>
    a.nom.toUpperCase().localeCompare(b.nom.toUpperCase())
  );

  let followedPeoples: IPeople[] = [];
  if (user.followedPeople.length > 0)
    followedPeoples = await People.find({
      _id: { $in: user.followedPeople.map((p) => p.peopleId) }
    }).lean();

  const followedPeopleTab: {
    nomPrenom: string;
    prenomNom?: string;
    peopleId?: Types.ObjectId;
    JORFSearchLink?: string;
  }[] = [];
  user.followedNames.forEach((p) => followedPeopleTab.push({ nomPrenom: p }));
  followedPeoples.forEach((p) =>
    followedPeopleTab.push({
      nomPrenom: `${p.nom} ${p.prenom}`,
      prenomNom: `${p.prenom} ${p.nom}`,
      peopleId: p._id,
      JORFSearchLink: getJORFSearchLinkPeople(p.prenom + " " + p.nom)
    })
  );

  // Sort the array by alphabetic order of lastnames
  followedPeopleTab.sort((a, b) =>
    a.nomPrenom.toUpperCase().localeCompare(b.nomPrenom.toUpperCase())
  );

  return {
    functions: followedFunctions.map((f) => f.functionTag),
    organisations: followedOrganisations,
    peopleAndNames: followedPeopleTab,
    meta: []
  };
}

export const listCommand = async (session: ISession) => {
  await session.log({ event: "/list" });

  try {
    await session.sendTypingAction();

    // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText);
      return;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal =
      userFollows.functions.length +
      userFollows.organisations.length +
      userFollows.peopleAndNames.length +
      userFollows.meta.length;
    if (followTotal == 0) {
      await session.sendMessage(noDataText);
      return;
    }

    let text = "";

    let i = 0;
    if (userFollows.functions.length > 0) {
      text += `Vous suivez ${String(userFollows.functions.length)} fonction${userFollows.functions.length > 1 ? "s" : ""} : \n\n`;
      const functionsKeys = getFunctionsFromValues(userFollows.functions);
      for (; i < userFollows.functions.length; i++) {
        text += `${String(i + 1)}. *${functionsKeys[i]}*`;

        if (session.messageApp === "Telegram")
          text += ` - [JORFSearch](${getJORFSearchLinkFunctionTag(userFollows.functions[i])})`;
        else
          text += `\n${getJORFSearchLinkFunctionTag(userFollows.functions[i])}`;
        text += `\n`;
        if (userFollows.functions.length < 10) text += `\n`;
      }
    }

    let k = 0;
    if (userFollows.organisations.length > 0) {
      text += `Vous suivez ${String(userFollows.organisations.length)} organisation${userFollows.organisations.length > 1 ? "s" : ""} : \n\n`;
      for (; k < userFollows.organisations.length; k++) {
        text += `${String(i + k + 1)}. *${userFollows.organisations[k].nom}*`;

        if (session.messageApp === "Telegram")
          text += ` - [JORFSearch](${getJORFSearchLinkOrganisation(userFollows.organisations[k].wikidataId)})`;
        else
          text += `\n${getJORFSearchLinkOrganisation(
            userFollows.organisations[k].wikidataId
          )}`;

        text += `\n`;
        if (userFollows.organisations.length < 10) text += `\n`;
      }
    }

    let j = 0;
    if (userFollows.peopleAndNames.length > 0) {
      text += `Vous suivez ${String(userFollows.peopleAndNames.length)} personne${userFollows.peopleAndNames.length > 1 ? "s" : ""} : \n\n`;
      for (; j < userFollows.peopleAndNames.length; j++) {
        const followedName = userFollows.peopleAndNames[j];
        text += `${String(i + k + j + 1)}. *${followedName.nomPrenom}*`;
        if (followedName.JORFSearchLink !== undefined) {
          if (session.messageApp !== "WhatsApp")
            text += ` - [JORFSearch](${followedName.JORFSearchLink})`;
          else text += `\n${followedName.JORFSearchLink}`;
          text += `\n`;
        } else {
          text += ` - Suivi manuel\n`;
        }
        if (
          userFollows.peopleAndNames[j + 1] &&
          userFollows.peopleAndNames.length < 10
        ) {
          text += `\n`;
        }
      }
    }

    if (session.messageApp === "Signal")
      await session.sendMessage(text, [
        [KEYBOARD_KEYS.FOLLOWS_REMOVE.key],
        [KEYBOARD_KEYS.MAIN_MENU.key]
      ]);
    else {
      text +=
        "\nPour retirer un suivi, précisez le(s) nombre(s) à supprimer: *Retirer 1 4 7*";
      await session.sendMessage(text);
    }
  } catch (error) {
    console.log(error);
  }
};

export const unfollowTelegram = async (session: ISession) => {
  await session.log({ event: "/unfollow" });
  try {
    await session.sendTypingAction();

    // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText);
      return;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal =
      userFollows.functions.length +
      userFollows.organisations.length +
      userFollows.peopleAndNames.length +
      userFollows.meta.length;
    if (followTotal == 0) {
      await session.sendMessage(noDataText);
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    const question = await tgBot.sendMessage(
      tgSession.chatIdTg,
      `Entrez le(s) nombre(s) correspondant au(x) contact(s) à supprimer.\nExemple: 1 4 7\n
Si nécessaire, vous pouvez utiliser la commande /list pour revoir vos suivis`,
      {
        reply_markup: {
          force_reply: true
        }
      }
    );

    tgBot.onReplyToMessage(
      tgSession.chatIdTg,
      question.message_id,
      (tgMsg: TelegramBot.Message) => {
        void (async () => {
          if (session.user == undefined) return;

          if (tgMsg.text == "/list") {
            await listCommand(session);
            return;
          }

          await unfollowFromStr(
            session,
            "Retirer " + (tgMsg.text ?? ""),
            false
          );
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};

export const unfollowFromStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
) => {
  try {
    if (triggerUmami) await session.log({ event: "/unfollow" });

    if (session.user == null) {
      await session.sendMessage(noDataText);
      return;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal =
      userFollows.functions.length +
      userFollows.organisations.length +
      userFollows.peopleAndNames.length +
      userFollows.meta.length;
    if (followTotal == 0) {
      await session.sendMessage(noDataText);
      return;
    }

    const selectionUnfollowText = msg.split(" ").slice(1).join(" ");

    let answers = parseIntAnswers(selectionUnfollowText, followTotal);

    if (answers.length === 0) {
      const text = `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(followTotal)}.`;
      if (session.messageApp === "Telegram")
        await session.sendMessage(text, [
          [KEYBOARD_KEYS.FOLLOWS_REMOVE.key],
          [KEYBOARD_KEYS.MAIN_MENU.key]
        ]);
      else await session.sendMessage(text);
      return;
    }

    // Shift all answers by 1 to get array-wise indexes
    answers = answers.map((i) => i - 1);

    const unfollowedFunctions = answers
      .filter((i) => i < userFollows.functions.length)
      .map((i) => userFollows.functions[i]);

    const unfollowedOrganisations = answers
      .filter(
        (i) =>
          i >= userFollows.functions.length &&
          i < userFollows.organisations.length + userFollows.functions.length
      )
      .map((i) => userFollows.organisations[i - userFollows.functions.length]);

    const unfollowedPeopleIdx = answers
      .filter(
        (i) =>
          i >= userFollows.functions.length + userFollows.organisations.length
      )
      .map(
        (i) =>
          i - userFollows.functions.length - userFollows.organisations.length
      );

    const unfollowedPrenomNomTab: string[] = [];

    const unfollowedPeopleId = unfollowedPeopleIdx.reduce(
      (tab: Types.ObjectId[], idx) => {
        if (userFollows.peopleAndNames[idx].peopleId === undefined) return tab;
        tab.push(userFollows.peopleAndNames[idx].peopleId);

        unfollowedPrenomNomTab.push(
          userFollows.peopleAndNames[idx].prenomNom ??
            userFollows.peopleAndNames[idx].nomPrenom
        );
        return tab;
      },
      []
    );

    const unfollowedNamesIdx = unfollowedPeopleIdx.reduce(
      (tab: number[], idx) => {
        if (userFollows.peopleAndNames[idx].peopleId !== undefined) return tab;
        if (session.user == null) return tab;

        const idInFollowedNameTab = session.user.followedNames.findIndex(
          (name) => name === userFollows.peopleAndNames[idx].nomPrenom
        );
        if (idInFollowedNameTab == -1) return tab;
        tab.push(idInFollowedNameTab);
        const nameTab =
          session.user.followedNames[idInFollowedNameTab].split(" ");
        unfollowedPrenomNomTab.push(
          `${nameTab[nameTab.length - 1]} ${nameTab.slice(0, nameTab.length - 1).join(" ")}`
        );
        return tab;
      },
      []
    );

    let text = "";

    const unfollowedFunctionsKeys = getFunctionsFromValues(unfollowedFunctions);

    const unfollowedTotal =
      unfollowedFunctions.length +
      unfollowedOrganisations.length +
      unfollowedPeopleId.length +
      unfollowedNamesIdx.length;

    // If only 1 item unfollowed
    if (unfollowedTotal === 1) {
      if (unfollowedFunctions.length === 1) {
        text += `Vous ne suivez plus la fonction *${
          unfollowedFunctionsKeys[0]
        }* 🙅‍♂️`;
      } else if (unfollowedOrganisations.length === 1) {
        text += `Vous ne suivez plus l'organisation *${unfollowedOrganisations[0].nom}* 🙅‍♂️`;
      } else if (unfollowedPrenomNomTab.length === 1) {
        text += `Vous ne suivez plus la personne *${unfollowedPrenomNomTab[0]}* 🙅‍♂️`;
      }
    } else if (unfollowedTotal === unfollowedFunctions.length) {
      // If only 1 type of unfollowed items: functions
      text +=
        "Vous ne suivez plus les fonctions 🙅‍ :" +
        unfollowedFunctions
          .map((_fct, i) => `\n - *${unfollowedFunctionsKeys[i]}*`)
          .join("");
    } else if (unfollowedTotal === unfollowedOrganisations.length) {
      // If only 1 type of unfollowed items: organisations
      text +=
        "Vous ne suivez plus les organisations 🙅‍ :" +
        unfollowedOrganisations.map((org) => `\n - *${org.nom}*`).join("");
    } else if (unfollowedTotal === unfollowedPrenomNomTab.length) {
      // If only 1 type of unfollowed items: people
      text +=
        "Vous ne suivez plus les personnes 🙅‍ :" +
        unfollowedPrenomNomTab.map((p) => `\n - *${p}*`).join("");
    } else {
      // Mixed types of unfollowed items
      text += "Vous ne suivez plus les items 🙅‍ :";
      if (unfollowedFunctions.length > 0) {
        if (unfollowedFunctions.length === 1) {
          text += `\n- Fonction : *${unfollowedFunctionsKeys[0]}*`;
        } else {
          text +=
            `\n- Fonctions :` +
            unfollowedFunctions
              .map((_fct, i) => `\n   - *${unfollowedFunctionsKeys[i]}*`)
              .join("");
        }
      }
      if (unfollowedOrganisations.length > 0) {
        if (unfollowedOrganisations.length === 1) {
          text += `\n- Organisation : *${unfollowedOrganisations[0].nom}*`;
        } else {
          text +=
            `\n- Organisations :` +
            unfollowedOrganisations
              .map((org) => `\n   - *${org.nom}*`)
              .join("");
        }
      }
      if (unfollowedPrenomNomTab.length > 0) {
        if (unfollowedPrenomNomTab.length === 1) {
          text += `\n- Personne : *${unfollowedPrenomNomTab[0]}`;
        } else {
          text +=
            `\n- Personnes :` +
            unfollowedPrenomNomTab.map((p) => `\n   - *${p}*`).join("");
        }
      }
    }

    session.user.followedPeople = session.user.followedPeople.filter(
      (people) =>
        !unfollowedPeopleId
          .map((id) => id.toString())
          .includes(people.peopleId.toString())
    );

    session.user.followedNames = session.user.followedNames.filter(
      (_value, idx) => !unfollowedNamesIdx.includes(idx)
    );

    session.user.followedOrganisations =
      session.user.followedOrganisations.filter(
        (org) =>
          !unfollowedOrganisations
            .map((o) => o.wikidataId)
            .includes(org.wikidataId)
      );

    session.user.followedFunctions = session.user.followedFunctions.filter(
      (tag) => !unfollowedFunctions.includes(tag.functionTag)
    );

    await session.user.save();

    // Delete the user if it doesn't follow anything any more
    if (session.user.followsNothing()) {
      await User.deleteOne({ _id: session.user._id });
      await session.log({ event: "/user-deletion-no-follow" });
    }

    await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};
