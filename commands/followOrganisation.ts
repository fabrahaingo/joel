import umami from "../utils/umami.ts";
import Organisation from "../models/Organisation.ts";
import User from "../models/User.ts";
import { IOrganisation, ISession, IUser, WikidataId } from "../types.ts";
import axios from "axios";
import { parseIntAnswers } from "../utils/text.utils.ts";
import { getJORFSearchLinkOrganisation } from "../utils/JORFSearch.utils.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

const isOrganisationAlreadyFollowed = (
  user: IUser,
  wikidataId: WikidataId
): boolean => {
  return user.followedOrganisations.some((o) => o.wikidataId === wikidataId);
};

interface WikiDataAPIResponse {
  success: number;
  search: {
    id: WikidataId;
  }[];
}

async function searchOrganisationWikidataId(
  org_name: string
): Promise<{ nom: string; wikidataId: WikidataId }[]> {
  try {
    if (org_name.length == 0) return [];

    await umami.log({ event: "/jorfsearch-request-wikidata-names" });

    const wikidataIds_raw: WikidataId[] = await axios
      .get<WikiDataAPIResponse>(
        encodeURI(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`
        )
      )
      .then((r) => {
        return r.data.search.map((o) => o.id);
      });
    if (wikidataIds_raw.length == 0) return []; // prevents unnecessary jorf event

    return (
      await axios
        .get<
          { name: string; id: WikidataId }[]
        >(encodeURI(`https://jorfsearch.steinertriples.ch/wikidata_id_to_name?ids[]=${wikidataIds_raw.join("&ids[]=")}`))
        .then((r) => r.data)
    ).map((o) => ({
      nom: o.name,
      wikidataId: o.id
    }));
  } catch (error) {
    console.log(error);
    return [];
  }
}

const ORGANISATION_SEARCH_PROMPT =
  "Entrez le nom ou l'identifiant Wikidata de l'organisation que vous souhaitez suivre:\n" +
  "Exemples:\n*Conseil d'État* ou *Q769657*\n*Conseil constitutionnel* ou *Q1127218*";

const ORGANISATION_SEARCH_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const ORGANISATION_SELECTION_PROMPT =
  "Entrez le(s) nombre(s) correspondant au(x) organisation(s) à suivre.\nExemple: 1 4 7";

const ORGANISATION_SELECTION_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.ORGANISATION_FOLLOW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const ORGANISATION_CONFIRM_KEYBOARD: Keyboard = [
  [{ text: "Oui" }, { text: "Non" }],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

async function askOrganisationSelectionQuestion(
  session: ISession,
  context: OrganisationSelectionContext
): Promise<void> {
  await askFollowUpQuestion(
    session,
    ORGANISATION_SELECTION_PROMPT,
    handleOrganisationSelection,
    {
      context,
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : ORGANISATION_SELECTION_KEYBOARD
    }
  );
}

async function askOrganisationConfirmationQuestion(
  session: ISession,
  context: OrganisationConfirmationContext
): Promise<void> {
  await askFollowUpQuestion(
    session,
    "Voulez-vous ajouter cette organisation à vos suivis ? (répondez *oui* ou *non*)",
    handleOrganisationConfirmation,
    {
      context,
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : ORGANISATION_CONFIRM_KEYBOARD
    }
  );
}

interface OrganisationSelectionContext {
  organisations: { nom: string; wikidataId: WikidataId }[];
}

interface OrganisationConfirmationContext {
  organisation: { nom: string; wikidataId: WikidataId };
}

async function askOrganisationSearch(session: ISession): Promise<void> {
  await askFollowUpQuestion(
    session,
    ORGANISATION_SEARCH_PROMPT,
    handleOrganisationSearchAnswer,
    {
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : ORGANISATION_SEARCH_KEYBOARD
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
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp" ? undefined : ORGANISATION_SEARCH_KEYBOARD
    );
    await askOrganisationSearch(session);
    return true;
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

  const orgResults = await searchOrganisationWikidataId(orgName);

  const keyboard =
    session.messageApp === "WhatsApp"
      ? undefined
      : ORGANISATION_SEARCH_KEYBOARD;

  if (orgResults.length == 0) {
    let text = `Votre recherche n'a donné aucun résultat. 👎\nVeuillez essayer de nouveau la commande.`;
    if (session.messageApp === "WhatsApp") {
      text += `\n\nFormat:\n*RechercherO Nom de l'organisation*\nou\n*RechercherO WikidataId de l'organisation*`;
    } else {
      text += `\n\nFormat:\n*Nom de l'organisation*\nou\n*WikidataId de l'organisation*`;
    }
    await session.sendMessage(text, keyboard);
    await askOrganisationSearch(session);
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

  if (session.user && isOrganisationAlreadyFollowed(session.user, organisation.wikidataId)) {
    text += `\nVous suivez déjà *${organisation.nom}* ✅`;
    await session.sendMessage(
      text,
      session.messageApp === "WhatsApp" ? undefined : ORGANISATION_SEARCH_KEYBOARD
    );
    await askOrganisationSearch(session);
    return;
  }

  text += `\nSouhaitez-vous suivre cette organisation ?`;

  await session.sendMessage(text);
  await askOrganisationConfirmationQuestion(session, { organisation });
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
    text += "Des résultats ont pu être omis en raison de la taille de la liste.\n\n";

  await session.sendMessage(text);
  await askOrganisationSelectionQuestion(session, {
    organisations: orgResults
  });
}

async function handleOrganisationSelection(
  session: ISession,
  answer: string,
  context: OrganisationSelectionContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp"
        ? undefined
        : ORGANISATION_SELECTION_KEYBOARD
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
      session.messageApp === "WhatsApp"
        ? undefined
        : ORGANISATION_SELECTION_KEYBOARD
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

async function handleOrganisationConfirmation(
  session: ISession,
  answer: string,
  context: OrganisationConfirmationContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp"
        ? undefined
        : ORGANISATION_CONFIRM_KEYBOARD
    );
    await askOrganisationConfirmationQuestion(session, context);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (/oui/i.test(trimmedAnswer)) {
    await followOrganisationsFromWikidataIdStr(
      session,
      `SuivreO ${context.organisation.wikidataId}`,
      false
    );
    return true;
  }

  if (/non/i.test(trimmedAnswer)) {
    await session.sendMessage(`Ok, aucun ajout n'a été effectué. 👌`);
    await askOrganisationSearch(session);
    return true;
  }

  await session.sendMessage(
    `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
    session.messageApp === "WhatsApp"
      ? undefined
      : ORGANISATION_CONFIRM_KEYBOARD
  );
  await askOrganisationConfirmationQuestion(session, context);
  return true;
}

export const followOrganisationTelegram = async (session: ISession) => {
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
    await processOrganisationSearch(session, orgName, triggerUmami);
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
      await session.sendMessage(
        text,
        session.messageApp !== "WhatsApp" ? tempKeyboard : undefined
      );
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
        const orgInfoFromJORF = await searchOrganisationWikidataId(id);
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

      await session.sendMessage(
        msg,
        session.messageApp !== "WhatsApp" ? tempKeyboard : undefined
      );
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
      await session.sendMessage(text, tempKeyboard);
    else await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};
