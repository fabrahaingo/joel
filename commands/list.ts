import People from "../models/People.ts";
import {
  FunctionTags,
  getFunctionsFromValues
} from "../entities/FunctionTags.ts";
import { IOrganisation, IPeople, ISession, IUser } from "../types.ts";
import Organisation from "../models/Organisation.ts";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { Types } from "mongoose";
import User from "../models/User.ts";
import {
  getJORFSearchLinkOrganisation,
  getJORFSearchLinkFunctionTag,
  getJORFSearchLinkPeople
} from "../utils/JORFSearch.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

export interface UserFollows {
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

export function getUserFollowsTotal(userFollows: UserFollows): number {
  return (
    userFollows.functions.length +
    userFollows.organisations.length +
    userFollows.peopleAndNames.length +
    userFollows.meta.length
  );
}

interface BuildFollowsListMessageOptions {
  perspective?: "self" | "thirdParty";
}

export function buildFollowsListMessage(
  session: ISession,
  userFollows: UserFollows,
  options: BuildFollowsListMessageOptions = {}
): string {
  const perspective = options.perspective ?? "self";
  const followVerb =
    perspective === "thirdParty" ? "Ce compte suit" : "Vous suivez";

  let text = "";
  let index = 0;

  if (userFollows.functions.length > 0) {
    text += `${followVerb} ${String(userFollows.functions.length)} fonction${
      userFollows.functions.length > 1 ? "s" : ""
    } : \n\n`;
    const functionsKeys = getFunctionsFromValues(userFollows.functions);
    userFollows.functions.forEach((_functionTag, idx) => {
      text += `${String(index + 1)}. *${functionsKeys[idx]}*`;

      if (session.messageApp === "Telegram")
        text += ` - [JORFSearch](${getJORFSearchLinkFunctionTag(
          userFollows.functions[idx]
        )})`;
      else
        text += `\n${getJORFSearchLinkFunctionTag(userFollows.functions[idx])}`;
      text += `\n`;
      if (userFollows.functions.length < 10) text += `\n`;
      index++;
    });
  }

  if (userFollows.organisations.length > 0) {
    text += `${followVerb} ${String(
      userFollows.organisations.length
    )} organisation${userFollows.organisations.length > 1 ? "s" : ""} : \n\n`;
    userFollows.organisations.forEach((organisation) => {
      text += `${String(index + 1)}. *${organisation.nom}*`;

      if (session.messageApp === "Telegram")
        text += ` - [JORFSearch](${getJORFSearchLinkOrganisation(
          organisation.wikidataId
        )})`;
      else
        text += `\n${getJORFSearchLinkOrganisation(organisation.wikidataId)}`;

      text += `\n`;
      if (userFollows.organisations.length < 10) text += `\n`;
      index++;
    });
  }

  if (userFollows.peopleAndNames.length > 0) {
    text += `${followVerb} ${String(
      userFollows.peopleAndNames.length
    )} personne${userFollows.peopleAndNames.length > 1 ? "s" : ""} : \n\n`;
    userFollows.peopleAndNames.forEach((followedName, idx) => {
      text += `${String(index + 1)}. *${followedName.nomPrenom}*`;
      if (followedName.JORFSearchLink !== undefined) {
        if (session.messageApp !== "WhatsApp")
          text += ` - [JORFSearch](${followedName.JORFSearchLink})`;
        else text += `\n${followedName.JORFSearchLink}`;
        text += `\n`;
      } else {
        text += ` - Suivi manuel\n`;
      }
      if (
        idx + 1 < userFollows.peopleAndNames.length &&
        userFollows.peopleAndNames.length < 10
      ) {
        text += `\n`;
      }
      index++;
    });
  }

  return text;
}

const noDataText = `Vous ne suivez aucun contact, fonction, ni organisation pour le moment.`;

export async function getAllUserFollowsOrdered(
  user: IUser
): Promise<UserFollows> {
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

    let text = buildFollowsListMessage(session, userFollows);

    if (session.messageApp === "Signal")
      text +=
        "\nPour retirer un suivi, précisez le(s) nombre(s) à supprimer: *Retirer 1 4 7*";

    const tempKeyboard: Keyboard = [
      [KEYBOARD_KEYS.FOLLOWS_REMOVE.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ];
    await session.sendMessage(text, { keyboard: tempKeyboard });
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};

const UNFOLLOW_PROMPT_TEXT =
  "Entrez le(s) nombre(s) correspondant au(x) contact(s) à supprimer.\n" +
  "Exemple: 1 4 7\n";

const UNFOLLOW_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.FOLLOWS_LIST.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

async function askUnfollowQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(
    session,
    UNFOLLOW_PROMPT_TEXT,
    handleUnfollowAnswer,
    {
      messageOptions: { keyboard: UNFOLLOW_KEYBOARD }
    }
  );
}

async function handleUnfollowAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options. 👎\nRéessayer la commande`,
      { keyboard: UNFOLLOW_KEYBOARD }
    );
    return true;
  }

  await unfollowFromStr(session, `Retirer ${trimmedAnswer}`, false);
  return true;
}

export const unfollowCommand = async (session: ISession) => {
  await session.log({ event: "/unfollow" });
  try {
    await session.sendTypingAction();

    if (session.user == null) {
      await session.sendMessage(noDataText);
      return;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal = getUserFollowsTotal(userFollows);
    if (followTotal == 0) {
      await session.sendMessage(noDataText);
      return;
    }

    await askUnfollowQuestion(session);
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
};

export const unfollowFromStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
): Promise<boolean> => {
  try {
    if (triggerUmami) await session.log({ event: "/unfollow" });

    if (session.user == null) {
      await session.sendMessage(noDataText);
      return false;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal = getUserFollowsTotal(userFollows);
    if (followTotal == 0) {
      await session.sendMessage(noDataText);
      return false;
    }

    const selectionUnfollowText = msg.split(" ").slice(1).join(" ");

    let answers = parseIntAnswers(selectionUnfollowText, followTotal);

    if (answers.length === 0) {
      const text = `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(followTotal)}.`;
      if (session.messageApp === "Telegram")
        await session.sendMessage(text, {
          keyboard: [
            [KEYBOARD_KEYS.FOLLOWS_REMOVE.key],
            [KEYBOARD_KEYS.MAIN_MENU.key]
          ]
        });
      else await session.sendMessage(text);
      return false;
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
    return true;
  } catch (error) {
    console.log(error);
    await session.log({ event: "/console-log" });
  }
  return false;
};
