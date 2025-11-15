import Organisation from "../models/Organisation.ts";
import User from "../models/User.ts";
import { IOrganisation, ISession, IUser, WikidataId } from "../types.ts";
import { parseIntAnswers } from "../utils/text.utils.ts";
import {
  getJORFSearchLinkOrganisation,
  searchOrganisationWikidataId
} from "../utils/JORFSearch.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

const isOrganisationAlreadyFollowed = (
  user: IUser,
  wikidataId: WikidataId
): boolean => {
  return user.followedOrganisations.some((o) => o.wikidataId === wikidataId);
};

const FULL_COMMAND_PROMPT = `\n\nFormat:\n*RechercherO Nom de l'organisation*\nou\n*RechercherO WikidataId de l'organisation*`;

const ORGANISATION_SEARCH_PROMPT =
  "Entrez le nom ou l'identifiant Wikidata de l'organisation que vous souhaitez suivre:\n" +
  "Exemples:\n*Conseil d'État* ou *Q769657*\n*Conseil constitutionnel* ou *Q1127218*";

const ORGANISATION_SEARCH_KEYBOARD = [
  [KEYBOARD_KEYS.ORGANISATION_FOLLOW_NEW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const ORGANISATION_SELECTION_PROMPT =
  "Entrez le(s) nombre(s) correspondant au(x) organisation(s) à suivre.\nExemple: 1 4 7";

async function askOrganisationSelectionQuestion(
  session: ISession,
  context: OrganisationsConfirmationContext
): Promise<void> {
  await askFollowUpQuestion(
    session,
    ORGANISATION_SELECTION_PROMPT,
    handleOrganisationSelection,
    {
      context,
      messageOptions: {
        keyboard: ORGANISATION_SEARCH_KEYBOARD
      }
    }
  );
}

interface OrganisationsConfirmationContext {
  organisations: { nom: string; wikidataId: WikidataId }[];
}

async function askOrganisationSearch(session: ISession): Promise<void> {
  await askFollowUpQuestion(
    session,
    ORGANISATION_SEARCH_PROMPT,
    handleOrganisationSearchAnswer,
    {
      messageOptions: {
        keyboard: [[KEYBOARD_KEYS.MAIN_MENU.key]]
      }
    }
  );
}

async function handleOrganisationSearchAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau.`,
      { keyboard: ORGANISATION_SEARCH_KEYBOARD }
    );
    await askOrganisationSearch(session);
    return true;
  }

  switch (trimmedAnswer) {
    case KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text:
    case KEYBOARD_KEYS.FOLLOW_UP_HISTORY.key.text:
    case KEYBOARD_KEYS.FOLLOW_UP_FOLLOW_MANUAL.key.text:
      return false;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  await session.sendTypingAction();
  await processOrganisationSearch(session, trimmedAnswer, false);
  return true;
}

async function processOrganisationSearch(
  session: ISession,
  orgName: string,
  triggerUmami = true
): Promise<void> {
  if (triggerUmami) await session.log({ event: "/follow-organisation" });

  const orgResults = await searchOrganisationWikidataId(
    orgName,
    session.messageApp
  );
  if (orgResults == null) {
    await session.sendMessage(
      "Une erreur JORFSearch indépendante de JOEL est survenue. Veuillez réessayer ultérieurement."
    );
    return;
  }

  if (orgResults.length == 0) {
    let text = `Votre recherche n'a donné aucun résultat. 👎\nVeuillez essayer de nouveau la commande.`;
    if (session.messageApp === "Signal") {
      text += `\n\nFormat:\n*RechercherO Nom de l'organisation*\nou\n*RechercherO WikidataId de l'organisation*`;
    } else {
      text += `\n\nFormat:\n*Nom de l'organisation*\nou\n*WikidataId de l'organisation*`;
    }
    await session.sendMessage(text, { keyboard: ORGANISATION_SEARCH_KEYBOARD });
    return;
  }

  session.user = await User.findOrCreate(session);

  if (orgResults.length === 1) {
    await handleSingleOrganisationResult(session, orgResults[0]);
    return;
  }

  await handleMultipleOrganisationResults(session, orgResults);
}

async function handleSingleOrganisationResult(
  session: ISession,
  organisation: { nom: string; wikidataId: WikidataId }
): Promise<void> {
  const orgUrl = getJORFSearchLinkOrganisation(organisation.wikidataId);

  let text = `Une organisation correspond à votre recherche:\n\n*${organisation.nom}* (${organisation.wikidataId})`;
  if (session.messageApp === "WhatsApp") {
    text += `\n${orgUrl}`;
  } else {
    text += ` - [JORFSearch](${orgUrl})`;
  }

  if (
    session.user &&
    isOrganisationAlreadyFollowed(session.user, organisation.wikidataId)
  ) {
    text += `\n\nVous suivez déjà *${organisation.nom}* ✅`;
    await session.sendMessage(text, { keyboard: ORGANISATION_SEARCH_KEYBOARD });
    return;
  } else {
    const tempKeyboard: Keyboard = ORGANISATION_SEARCH_KEYBOARD;
    tempKeyboard.unshift([KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key]);
    await askFollowUpQuestion(
      session,
      text,
      handleSingleOrganisationConfirmation,
      {
        context: { organisations: [organisation] },
        messageOptions: {
          keyboard: tempKeyboard
        }
      }
    );
  }
}

async function handleSingleOrganisationConfirmation(
  session: ISession,
  answer: string,
  context: OrganisationsConfirmationContext
): Promise<boolean> {
  if (answer === KEYBOARD_KEYS.FOLLOW_UP_FOLLOW.key.text) {
    await followOrganisationsFromWikidataIdStr(
      session,
      `SuivreO ${context.organisations[0].wikidataId}`,
      false
    );
    return true;
  }
  return false;
}

async function handleMultipleOrganisationResults(
  session: ISession,
  orgResults: { nom: string; wikidataId: WikidataId }[]
): Promise<void> {
  let text = "Voici les organisations correspondant à votre recherche :\n\n";
  for (let k = 0; k < orgResults.length; k++) {
    const organisation_k = orgResults[k];
    const orgUrl_k = getJORFSearchLinkOrganisation(organisation_k.wikidataId);

    text += `${String(k + 1)}. *${organisation_k.nom}* (${organisation_k.wikidataId})`;

    if (session.messageApp === "WhatsApp") {
      text += `\n${orgUrl_k}`;
    } else {
      text += ` - [JORFSearch](${orgUrl_k})`;
    }

    if (
      session.user != undefined &&
      isOrganisationAlreadyFollowed(session.user, organisation_k.wikidataId)
    )
      text += ` - Suivi ✅`;

    text += "\n\n";
  }

  if (orgResults.length >= 10)
    text +=
      "Des résultats ont pu être omis en raison de la taille de la liste.\n\n";

  await session.sendMessage(text);
  await askOrganisationSelectionQuestion(session, {
    organisations: orgResults
  });
}

async function handleOrganisationSelection(
  session: ISession,
  answer: string,
  context: OrganisationsConfirmationContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      { keyboard: ORGANISATION_SEARCH_KEYBOARD }
    );
    await askOrganisationSelectionQuestion(session, context);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  const answers = parseIntAnswers(trimmedAnswer, context.organisations.length);

  if (answers.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue: merci de renseigner une ou plusieurs options entre 1 et ${String(context.organisations.length)}. 👎`,
      { keyboard: ORGANISATION_SEARCH_KEYBOARD }
    );
    await askOrganisationSelectionQuestion(session, context);
    return true;
  }

  const selectedIds = answers.map(
    (idx) => context.organisations[idx - 1].wikidataId
  );

  await followOrganisationsFromWikidataIdStr(
    session,
    `SuivreO ${selectedIds.join(" ")}`,
    false
  );
  return true;
}

export const searchOrganisation = async (session: ISession) => {
  try {
    await session.log({ event: "/follow-organisation" });
    await askOrganisationSearch(session);
  } catch (error) {
    console.log(error);
  }
};

export const searchOrganisationFromStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
) => {
  try {
    const orgName = msg.split(" ").splice(1).join(" ");

    if (orgName)
      await processOrganisationSearch(session, orgName, triggerUmami);
    else await session.sendMessage(FULL_COMMAND_PROMPT);
  } catch (error) {
    console.log(error);
  }
};

export const followOrganisationsFromWikidataIdStr = async (
  session: ISession,
  msg: string,
  triggerUmami = true
) => {
  try {
    if (msg.trim().split(" ").length < 2) {
      await searchOrganisationFromStr(session, msg);
      return;
    }
    if (triggerUmami) await session.log({ event: "/follow-organisation" });
    await session.sendTypingAction();

    const selectedWikiDataIds = msg
      .split(" ")
      .splice(1)
      .map((s) => s.toUpperCase());

    const tempKeyboard: Keyboard = [
      [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ];

    if (selectedWikiDataIds.length == 0) {
      const text = `Votre recherche n'a donné aucun résultat 👎.\nVeuillez essayer de nouveau la commande.`;
      await session.sendMessage(text, { keyboard: tempKeyboard });
      return;
    }

    const parameterString = selectedWikiDataIds.join(" ");
    // if the id don't contain any number, it's an organisation name
    if (!/\d/.test(parameterString)) {
      await searchOrganisationFromStr(
        session,
        "RechercherO " + parameterString
      );
      return;
    }

    const orgResults: IOrganisation[] = [];

    const orgsInDb: IOrganisation[] = await Organisation.find({
      wikidataId: { $in: selectedWikiDataIds }
    }).lean();
    for (const id of selectedWikiDataIds) {
      const orgFromDb: IOrganisation | undefined = orgsInDb.find(
        (o) => o.wikidataId === id
      );
      if (orgFromDb != undefined) {
        orgResults.push(orgFromDb);
      } else {
        const orgInfoFromJORF = await searchOrganisationWikidataId(
          id,
          session.messageApp
        );

        if (orgInfoFromJORF == null) {
          await session.sendMessage(
            "Une erreur JORFSearch indépendante de JOEL est survenue. Veuillez réessayer ultérieurement."
          );
          return;
        }

        if (orgInfoFromJORF.length > 0) {
          const newOrg: IOrganisation = await Organisation.findOrCreate({
            nom: orgInfoFromJORF[0].nom,
            wikidataId: orgInfoFromJORF[0].wikidataId
          });
          orgResults.push(newOrg);
        }
      }
    }

    if (orgResults.length == 0) {
      let msg = "";
      if (selectedWikiDataIds.length > 1)
        msg += "Les ids fournis n'ont pas été reconnus. 👎";
      else msg += "L'id fourni n'a pas été reconnu. 👎";
      msg += "\nVeuillez essayer de nouveau la commande.";

      await session.sendMessage(msg, { keyboard: tempKeyboard });
      return;
    }

    session.user ??= await User.findOrCreate(session);

    for (const org of orgResults) {
      // Don't call JORF if the organisation is already followed
      if (!isOrganisationAlreadyFollowed(session.user, org.wikidataId))
        session.user.followedOrganisations.push({
          wikidataId: org.wikidataId,
          lastUpdate: new Date()
        });
    }

    await session.user.save();

    let text = "";

    if (orgResults.length == 1)
      text += `Vous suivez désormais *${orgResults[0].nom}* (${orgResults[0].wikidataId}) ✅`;
    else
      text += `Vous suivez désormais les organisations: ✅\n${orgResults
        .map((org) => `\n   - *${org.nom}* (${org.wikidataId})`)
        .join("\n")}`;

    if (session.messageApp === "Telegram")
      await session.sendMessage(text, { keyboard: tempKeyboard });
    else await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};
