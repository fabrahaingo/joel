import People from "../models/People.ts";
import {
  FunctionTags,
  getFunctionsFromValues
} from "../entities/FunctionTags.ts";
import {
  ButtonElement,
  IOrganisation,
  IPeople,
  ISession,
  IUser
} from "../types.ts";
import Organisation from "../models/Organisation.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
import TelegramBot from "node-telegram-bot-api";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { Types } from "mongoose";
import User from "../models/User.ts";

interface UserFollows {
  functions: FunctionTags[];
  organisations: IOrganisation[];
  peopleAndNames: {
    nomPrenom: string;
    prenomNom?: string;
    peopleId?: Types.ObjectId;
    JORFSearchLink?: string;
  }[];
}

const noDataText = `Vous ne suivez aucun contact, fonction, ni organisation pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;

async function getAllUserFollowsOrdered(user: IUser): Promise<UserFollows> {
  const followedFunctions = user.followedFunctions.sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });

  const followedOrganisations: IOrganisation[] = await Organisation.find({
    wikidataId: {
      $in: user.followedOrganisations.map((o) => o.wikidataId)
    }
  })
    .collation({ locale: "fr" })
    .sort({ nom: 1 });

  const followedPeoples: IPeople[] = await People.find({
    _id: { $in: user.followedPeople.map((p) => p.peopleId) }
  })
    .collation({ locale: "fr" })
    .lean();

  const followedPeopleTab: {
    nomPrenom: string;
    peopleId?: Types.ObjectId;
    JORFSearchLink?: string;
  }[] = [];
  user.followedNames.forEach((p) => followedPeopleTab.push({ nomPrenom: p }));
  followedPeoples.forEach((p) =>
    followedPeopleTab.push({
      nomPrenom: `${p.nom} ${p.prenom}`,
      prenomNom: `${p.prenom} ${p.nom}`,
      peopleId: p._id,
      JORFSearchLink: encodeURI(
        `https://jorfsearch.steinertriples.ch/name/${p.prenom} ${p.nom}`
      )
    })
  );

  // Sort the array by alphabetic order of lastnames
  followedPeopleTab.sort((a, b) => {
    if (a.nomPrenom.toUpperCase() < b.nomPrenom.toUpperCase()) return -1;
    if (a.nomPrenom.toUpperCase() > b.nomPrenom.toUpperCase()) return 1;
    return 0;
  });

  return {
    functions: followedFunctions,
    organisations: followedOrganisations,
    peopleAndNames: followedPeopleTab
  };
}

export const listCommand = async (session: ISession) => {
  await session.log({ event: "/list" });

  try {
    await session.sendTypingAction();

    // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText, session.mainMenuKeyboard);
      return;
    }
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal =
      userFollows.functions.length +
      userFollows.organisations.length +
      userFollows.peopleAndNames.length;
    if (followTotal == 0) {
      await session.sendMessage(noDataText, session.mainMenuKeyboard);
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
          text += ` - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
            userFollows.functions[i]
          )})\n\n`;

        text += `\n\n`;
      }
    }

    let k = 0;
    if (userFollows.organisations.length > 0) {
      text += `Vous suivez ${String(userFollows.organisations.length)} organisation${userFollows.organisations.length > 1 ? "s" : ""} : \n\n`;
      for (; k < userFollows.organisations.length; k++) {
        text += `${String(i + k + 1)}. *${userFollows.organisations[k].nom}*`;

        if (session.messageApp === "Telegram")
          text += ` - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(
            userFollows.organisations[k].wikidataId
          )})\n\n`;

        text += `\n\n`;
      }
    }

    let j = 0;
    if (userFollows.peopleAndNames.length > 0) {
      text += `Vous suivez ${String(userFollows.peopleAndNames.length)} personne${userFollows.peopleAndNames.length > 1 ? "s" : ""} : \n\n`;
      for (; j < userFollows.peopleAndNames.length; j++) {
        const followedName = userFollows.peopleAndNames[j];
        text += `${String(i + k + j + 1)}. *${followedName.nomPrenom}* - `;
        if (followedName.JORFSearchLink !== undefined) {
          if (session.messageApp === "Telegram")
            text += `[JORFSearch](${followedName.JORFSearchLink})`;
          text += `\n`;
        } else {
          text += `Suivi manuel\n`;
        }
        if (userFollows.peopleAndNames[j + 1]) {
          text += `\n`;
        }
      }
    }

    const temp_keyboard = [
      [{ text: "✋ Retirer un suivi" }],
      [{ text: "🏠 Menu principal" }]
    ];

    await session.sendMessage(text, temp_keyboard);
  } catch (error) {
    console.log(error);
  }
};

export const unfollowCommand = async (session: ISession) => {
  try {
    await session.log({ event: "/unfollow" });
    await session.sendTypingAction();

    // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText, session.mainMenuKeyboard);
      return;
    }

    switch (session.messageApp) {
      case "Telegram": {
        await unfollowTelegram(session);
        return;
      }

      case "WhatsApp": {
        await unfollowMenuWhatsApp(session);
        return;
      }
      default:
        throw new Error("Unknown message app");
    }
  } catch (error) {
    console.log(error);
  }
};

export const unfollowMenuWhatsApp = async (session: ISession) => {
  try {
    await session.sendTypingAction();

    if (session.user == null) return;

    const userFollows = await getAllUserFollowsOrdered(session.user);

    let unfollowButtons: ButtonElement[] = [];

    unfollowButtons = unfollowButtons.concat(
      getFunctionsFromValues(userFollows.functions).map((f) => ({ text: f }))
    );

    unfollowButtons = unfollowButtons.concat(
      userFollows.organisations.map((f) => ({ text: f.nom }))
    );

    unfollowButtons = unfollowButtons.concat(
      userFollows.peopleAndNames.map((p) => ({ text: p.nomPrenom }))
    );

    await session.sendMessage(
      "Choisissez un contact à retirer",
      [unfollowButtons.map((b) => ({ text: `Retirer ${b.text}` }))],
      "List"
    );
  } catch (error) {
    console.log(error);
  }
};

export const unfollowTelegram = async (session: ISession) => {
  try {
    await session.sendTypingAction();

    // We only want to create a user upon use of the follow function
    if (session.user == null) return;
    const userFollows = await getAllUserFollowsOrdered(session.user);

    const followTotal =
      userFollows.functions.length +
      userFollows.organisations.length +
      userFollows.peopleAndNames.length;
    if (followTotal == 0) {
      await session.sendMessage(noDataText, session.mainMenuKeyboard);
      return;
    }

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;

    const tgBot = tgSession.telegramBot;

    const question = await tgBot.sendMessage(
      session.chatId,
      `Entrez le(s) nombre(s) correspondant au(x) contact(s) à supprimer.\nExemple: 1 4 7\n
Si nécessaire, vous pouvez utiliser la commande /list pour revoir vos suivis`,
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
          if (session.user == undefined) return;

          if (tgMsg.text == "/list") {
            await listCommand(session);
            return;
          }

          let answers = parseIntAnswers(tgMsg.text, followTotal);
          if (answers === null) {
            await session.sendMessage(
              `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(followTotal)}.
👎 Veuillez essayer de nouveau la commande /unfollow.`,
              session.mainMenuKeyboard
            );
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
                i <
                  userFollows.organisations.length +
                    userFollows.functions.length
            )
            .map(
              (i) => userFollows.organisations[i - userFollows.functions.length]
            );

          const unfollowedPeopleIdx = answers
            .filter(
              (i) =>
                i >=
                userFollows.functions.length + userFollows.organisations.length
            )
            .map(
              (i) =>
                i -
                userFollows.functions.length -
                userFollows.organisations.length
            );

          const unfollowedPrenomNomTab: string[] = [];

          const unfollowedPeopleId = unfollowedPeopleIdx.reduce(
            (tab: Types.ObjectId[], idx) => {
              if (userFollows.peopleAndNames[idx].peopleId === undefined)
                return tab;
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
              if (userFollows.peopleAndNames[idx].peopleId !== undefined)
                return tab;
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

          await unfollowAndConfirm(
            session,
            unfollowedFunctions,
            unfollowedPrenomNomTab,
            unfollowedOrganisations,
            unfollowedNamesIdx,
            unfollowedPeopleId
          );
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};

const unfollowAndConfirm = async (
  session: ISession,
  unfollowedFunctions: FunctionTags[],
  unfollowedPrenomNomTab: string[],
  unfollowedOrganisations: IOrganisation[],
  unfollowedNamesIdx: number[],
  unfollowedPeopleId: Types.ObjectId[]
) => {
  try {
    let text = "";

    const unfollowedFunctionsKeys = getFunctionsFromValues(unfollowedFunctions);

    const unfollowedTotal =
      unfollowedFunctions.length +
      unfollowedOrganisations.length +
      unfollowedPeopleId.length;

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
      (tag) => !unfollowedFunctions.includes(tag)
    );

    await session.user.save();

    // Delete the user if it doesn't follow anything any more
    if (session.user.followsNothing()) {
      await User.deleteOne({ _id: session.user._id });
      await session.log({ event: "/user-deletion-no-follow" });
    }

    await session.sendMessage(text, session.mainMenuKeyboard);
  } catch (error) {
    console.log(error);
  }
};
