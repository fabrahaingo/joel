import People from "../models/People.js";
import { getFunctionsFromValues } from "../entities/FunctionTags.js";
import { IOrganisation, IPeople, ISession, IUser } from "../types.js";
import Organisation from "../models/Organisation.js";
import { mainMenuKeyboard } from "../utils/keyboards.js";

function sortFunctionsAlphabetically(array: IUser["followedFunctions"]) {
  array.sort((a, b) => {
    if (a < b) {
      return -1;
    }
    if (a > b) {
      return 1;
    }
    return 0;
  });
  return array;
}

export const listCommand = async (session: ISession, _msg: never) => {
  await session.log({ event: "/list" });

  try {
    await session.sendTypingAction();

    const noDataText=
        `Vous ne suivez aucun contact, fonction, ni organisation pour le moment. Cliquez sur *🧩 Ajouter un contact* pour commencer à suivre des contacts.`;

        // We only want to create a user upon use of the follow function
    if (session.user == null) {
      await session.sendMessage(noDataText, mainMenuKeyboard);
      return;
    }

    let text = "";

    const peoples: IPeople[] = await People.find({
      _id: { $in: session.user.followedPeople.map((p) => p.peopleId) },
    })
      .collation({ locale: "fr" })
      .lean();

    session.user.followedNames ??= [];
    const followedPeopleTab: {
      nomPrenom: string,
      JORFSearchLink?: string,
    }[] = [];
    session.user.followedNames.forEach(p=> followedPeopleTab.push({nomPrenom: p}));
    peoples.forEach(p=>followedPeopleTab.push({
      nomPrenom: `${p.nom} ${p.prenom}`,
      JORFSearchLink: encodeURI(`https://jorfsearch.steinertriples.ch/name/${p.prenom} ${p.nom}`),
    }));
    followedPeopleTab.sort((a, b) => {
      if (a.nomPrenom.toUpperCase() < b.nomPrenom.toUpperCase()) return -1;
      if (a.nomPrenom.toUpperCase() > b.nomPrenom.toUpperCase()) return 1;
      return 0;
    });

    const functions = sortFunctionsAlphabetically(
        session.user.followedFunctions,
    );
    session.user.followedOrganisations ??= [];
    const organisations: IOrganisation[] = await Organisation.find({
      wikidataId: {
        $in: session.user.followedOrganisations.map((o) => o.wikidataId),
      },
    })
      .collation({ locale: "fr" })
      .sort({ nom: 1 })
      .lean();
    if (
      followedPeopleTab.length === 0 &&
      organisations.length === 0 &&
      functions.length === 0
    ) {
      await session.sendMessage(noDataText, mainMenuKeyboard);
      return;
    }
    if (functions.length > 0) {
      text += `Voici les fonctions que vous suivez: \n\n`;
      const functionsKeys = getFunctionsFromValues(functions);
      for (let j = 0; j < functions.length; j++) {
        text += `${String(j + 1)}. *${functionsKeys[j]}* - [JORFSearch](https://jorfsearch.steinertriples.ch/tag/${encodeURI(
          functions[j],
        )})\n\n`;
      }
    }
    if (organisations.length > 0) {
      text += `Voici les organisations que vous suivez: \n\n`;
      for (let k = 0; k < organisations.length; k++) {
        text += `${String(
          k + 1,
        )}. *${organisations[k].nom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/${encodeURI(
          organisations[k].wikidataId,
        )})\n\n`;
      }
    }
    if (followedPeopleTab.length > 0) {
      text += `Voici les personnes que vous suivez: \n\n`;
      for (let i = 0; i < followedPeopleTab.length; i++) {
        const followedName= followedPeopleTab[i];
        text += `${String(
          i + 1,
        )}. *${followedName.nomPrenom}* - `;
        if (followedName.JORFSearchLink !== undefined) {
          text += `[JORFSearch](${followedName.JORFSearchLink})\n`;
        } else {
          text += `Suivi manuel\n`;
        }
        if (followedPeopleTab[i + 1]) {
          text += `\n`;
        }
      }

    }

    await session.sendMessage(text, mainMenuKeyboard);
  } catch (error) {
    console.log(error);
  }
};
