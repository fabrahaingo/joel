import User from "../models/User.ts";
import People from "../models/People.ts";
import { IPeople, ISession, WikidataId } from "../types.ts";
import {
  List_Promos_INSP_ENA,
  Promo_ENA_INSP
} from "../entities/PromoNames.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import {
  callJORFSearchOrganisation,
  callJORFSearchReference,
  callJORFSearchTag,
  cleanPeopleName
} from "../utils/JORFSearch.utils.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { Keyboard, KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import { askFollowUpQuestion } from "../entities/FollowUpManager.ts";

const inspId = "Q109039648" as WikidataId;

function findENAINSPPromo(input: string): Promo_ENA_INSP | null {
  const allPromoPeriods = List_Promos_INSP_ENA.map((i) => i.period);

  const cleanInput = cleanPeopleName(input.toLowerCase().replaceAll("-", " "));

  let promoIdx = List_Promos_INSP_ENA.map((i) =>
    i.name
      ? cleanPeopleName(i.name.toLowerCase()).replaceAll("-", " ")
      : undefined
  ).findIndex((i) => i === cleanInput);

  if (promoIdx === -1) {
    promoIdx = allPromoPeriods.findIndex(
      (i) => i === input.replaceAll("/", "-")
    );
  }

  // Promo not found
  if (promoIdx === -1) {
    return null;
  }

  return List_Promos_INSP_ENA[promoIdx];
}

async function getJORFPromoSearchResult(
  promo: Promo_ENA_INSP | null
): Promise<JORFSearchItem[]> {
  if (promo === null) {
    return [];
  }

  switch (promo.school) {
    case "ENA": // If ENA, we can use the associated tag with the year as value
      return callJORFSearchTag("eleve_ena" as FunctionTags, promo.period);

    case "INSP": // If INSP, we can rely on the associated organisation
      return (
        (await callJORFSearchOrganisation(inspId))
          // We filter to keep admissions to the INSP organisation from the relevant year
          .filter((publication) => publication.eleve_ena === promo.period)
      );
    default:
      return [];
  }
}

const PROMO_PROMPT_TEXT =
  "Entrez le nom de votre promo (ENA ou INSP) et l'*intégralité de ses élèves* sera ajoutée à la liste de vos contacts.\n" +
  "⚠️ Attention, un nombre important de suivis seront ajoutés en même temps, *les retirer peut ensuite prendre du temps* ⚠️\n" +
  "Formats acceptés:\nGeorges-Clemenceau\n2017-2018\n";

const PROMO_SEARCH_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.ENA_INSP_PROMO_LIST.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const PROMO_CONFIRM_TEXT =
  "Voulez-vous ajouter ces personnes à vos suivis ? (répondez *oui* ou *non*)\n\n" +
  "⚠️ Attention : *les retirer peut ensuite prendre du temps*.";

interface PromoConfirmContext {
  promoInfo: Promo_ENA_INSP;
  promoJORFList: JORFSearchItem[];
  promoLabel: string;
}

async function askPromoQuestion(session: ISession): Promise<void> {
  let text = PROMO_PROMPT_TEXT;
  if (session.messageApp === "Signal")
    text +=
      "Utilisez la command /promos pour consulter la liste des promotions INSP et ENA disponibles.";
  await askFollowUpQuestion(session, text, handlePromoAnswer, {
    keyboard: PROMO_SEARCH_KEYBOARD
  });
}

async function handlePromoAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.`,
      PROMO_SEARCH_KEYBOARD
    );
    await askPromoQuestion(session);
    return true;
  }

  const promoInfo = findENAINSPPromo(trimmedAnswer);

  if (promoInfo && !promoInfo.onJORF) {
    const promoStr = promoInfo.name
      ? `${promoInfo.name} (${promoInfo.period})`
      : promoInfo.period;

    await session.sendMessage(
      `La promotion *${promoStr}* n'est pas disponible dans les archives du JO car elle est trop ancienne.`,
      PROMO_SEARCH_KEYBOARD
    );
    await askPromoQuestion(session);
    return true;
  }

  let promoJORFList: JORFSearchItem[] = [];
  if (promoInfo !== null) {
    promoJORFList = await getJORFPromoSearchResult(promoInfo);
  }

  if (promoInfo == null || promoJORFList.length === 0) {
    let text = `La promotion n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.\n`;
    if (session.messageApp === "Signal")
      text +=
        "\nUtilisez la commande /promos pour consulter la liste des promotions INSP et ENA disponibles.";
    await session.sendMessage(text, PROMO_SEARCH_KEYBOARD);
    await askPromoQuestion(session);
    return true;
  }

  const promoStr = promoInfo.name
    ? `${promoInfo.name} (${promoInfo.period})`
    : promoInfo.period;

  await session.sendMessage(
    `La promotion *${promoStr}* contient *${String(promoJORFList.length)} élèves*:`
  );

  promoJORFList.sort((a, b) =>
    a.nom.toUpperCase().localeCompare(b.nom.toUpperCase())
  );

  const contacts = promoJORFList.map((contact) => {
    return `${contact.nom} ${contact.prenom}`;
  });

  let text = contacts.join("\n");
  text += "\n\n" + PROMO_CONFIRM_TEXT;

  await askFollowUpQuestion(session, text, handlePromoConfirmation, {
    context: {
      promoInfo,
      promoJORFList,
      promoLabel: promoStr
    }
  });
  return true;
}

async function handlePromoConfirmation(
  session: ISession,
  answer: string,
  context: PromoConfirmContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      PROMO_SEARCH_KEYBOARD
    );
    await askFollowUpQuestion(
      session,
      PROMO_CONFIRM_TEXT,
      handlePromoConfirmation,
      {
        context
      }
    );
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (/oui/i.test(trimmedAnswer)) {
    await session.sendMessage(`Ajout en cours... ⏰`, undefined, {
      forceNoKeyboard: true
    });
    await session.sendTypingAction();
    session.user ??= await User.findOrCreate(session);

    const peopleTab: IPeople[] = [];

    for (const contact of context.promoJORFList) {
      const people = await People.findOrCreate({
        nom: contact.nom,
        prenom: contact.prenom
      });
      peopleTab.push(people);
    }
    await session.user.addFollowedPeopleBulk(peopleTab);
    await session.user.save();
    await session.sendMessage(
      `Les *${String(peopleTab.length)} personnes* de la promo *${context.promoLabel}* ont été ajoutées à vos contacts.`
    );
    return true;
  }

  if (/non/i.test(trimmedAnswer)) {
    await session.sendMessage(`Ok, aucun ajout n'a été effectué. 👌`);
    return true;
  }

  await session.sendMessage(
    `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
    PROMO_SEARCH_KEYBOARD
  );
  await askFollowUpQuestion(
    session,
    PROMO_CONFIRM_TEXT,
    handlePromoConfirmation,
    {
      context
    }
  );
  return true;
}

export const enaCommand = async (session: ISession): Promise<void> => {
  try {
    await session.log({ event: "/ena" });
    await askPromoQuestion(session);
  } catch (error) {
    console.log(error);
  }
};

export const promosCommand = async (session: ISession): Promise<void> => {
  try {
    await session.log({ event: "/ena-list" });
    let text = `Les périodes et noms des promotions successives sont:\n\n`;

    // Promotions INSP
    text += "*Institut National du Service Public (INSP)*\n\n";
    for (const promoINSP of List_Promos_INSP_ENA.filter(
      (p) => p.school === "INSP"
    )) {
      text += `${promoINSP.period} : *${promoINSP.name ?? "À venir"}*\n`;
    }

    // Promotions ENA
    text += "\n*École Nationale d'Administration (ENA)*\n\n";
    for (const promoENA of List_Promos_INSP_ENA.filter(
      (p) => p.school === "ENA" && p.onJORF
    )) {
      text += `${promoENA.period} : *${promoENA.name ?? "À venir"}*\n`;
    }

    text +=
      "\nLes promotions antérieures ne sont pas disponibles sur JORFSearch.\n\n";

    if (session.messageApp === "Signal")
      text +=
        "Utilisez la commande /ENA ou /INSP pour suivre la promotion de votre choix.\n\n";

    await session.sendMessage(text, [
      [KEYBOARD_KEYS.ENA_INSP_PROMO_SEARCH.key],
      [KEYBOARD_KEYS.MAIN_MENU.key]
    ]);
  } catch (error) {
    console.log(error);
  }
};

interface ReferenceConfirmationContext {
  reference: string;
  results: JORFSearchItem[];
}

const REFERENCE_PROMPT_TEXT =
  "Entrez la référence JORF/BO et l'intégralité des personnes mentionnées sera ajoutée à la liste de vos contacts.\n" +
  "⚠️ Attention, un nombre important de suivis seront ajoutés en même temps, les retirer peut ensuite prendre du temps. ⚠️\n" +
  "Format: *JORFTEXT000052060473*";

const REFERENCE_PROMPT_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.REFERENCE_FOLLOW.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const REFERENCE_CONFIRM_TEXT =
  "Voulez-vous ajouter ces personnes à vos suivis ? (répondez *oui* ou *non*)\n\n⚠️ Attention : les retirer peut ensuite prendre du temps.";

const REFERENCE_CONFIRM_KEYBOARD: Keyboard = [
  [{ text: "Oui" }, { text: "Non" }],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

async function askReferenceQuestion(session: ISession): Promise<void> {
  await askFollowUpQuestion(
    session,
    REFERENCE_PROMPT_TEXT,
    handleReferenceAnswer,
    {
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : REFERENCE_PROMPT_KEYBOARD
    }
  );
}

async function handleReferenceAnswer(
  session: ISession,
  answer: string
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp" ? undefined : REFERENCE_PROMPT_KEYBOARD
    );
    await askReferenceQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  const reference = trimmedAnswer.toUpperCase();
  await session.sendTypingAction();

  const JORFResult = await callJORFSearchReference(reference);

  if (JORFResult.length === 0) {
    await session.sendMessage(
      `La référence n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp" ? undefined : REFERENCE_PROMPT_KEYBOARD
    );
    await askReferenceQuestion(session);
    return true;
  }

  await session.sendMessage(
    `Le texte *${reference}* mentionne *${String(JORFResult.length)} personnes*:`
  );

  JORFResult.sort((a, b) => {
    if (a.nom.toUpperCase() < b.nom.toUpperCase()) return -1;
    if (a.nom.toUpperCase() > b.nom.toUpperCase()) return 1;
    return 0;
  });

  const contacts = JORFResult.map((contact) => {
    return `${contact.nom} ${contact.prenom}`;
  });
  await session.sendMessage(contacts.join("\n"), null, {
    forceNoKeyboard: true
  });

  await askFollowUpQuestion(
    session,
    REFERENCE_CONFIRM_TEXT,
    handleReferenceConfirmation,
    {
      context: { reference, results: JORFResult },
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : REFERENCE_CONFIRM_KEYBOARD
    }
  );
  return true;
}

async function handleReferenceConfirmation(
  session: ISession,
  answer: string,
  context: ReferenceConfirmationContext
): Promise<boolean> {
  const trimmedAnswer = answer.trim();

  if (trimmedAnswer.length === 0) {
    await session.sendMessage(
      `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
      session.messageApp === "WhatsApp" ? undefined : REFERENCE_CONFIRM_KEYBOARD
    );
    await askFollowUpQuestion(
      session,
      REFERENCE_CONFIRM_TEXT,
      handleReferenceConfirmation,
      {
        context,
        keyboard:
          session.messageApp === "WhatsApp"
            ? undefined
            : REFERENCE_CONFIRM_KEYBOARD
      }
    );
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (/oui/i.test(trimmedAnswer)) {
    await session.sendTypingAction();
    session.user ??= await User.findOrCreate(session);

    const peopleTab: IPeople[] = [];

    for (const contact of context.results) {
      const people = await People.findOrCreate({
        nom: contact.nom,
        prenom: contact.prenom
      });
      peopleTab.push(people);
    }
    await session.user.addFollowedPeopleBulk(peopleTab);
    await session.user.save();
    await session.sendMessage(
      `Les *${String(peopleTab.length)} personnes* ont été ajoutées à vos contacts.`
    );
    return true;
  }

  if (/non/i.test(trimmedAnswer)) {
    await session.sendMessage(`Ok, aucun ajout n'a été effectué. 👌`);
    await askReferenceQuestion(session);
    return true;
  }

  await session.sendMessage(
    `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
    session.messageApp === "WhatsApp" ? undefined : REFERENCE_CONFIRM_KEYBOARD
  );
  await askFollowUpQuestion(
    session,
    REFERENCE_CONFIRM_TEXT,
    handleReferenceConfirmation,
    {
      context,
      keyboard:
        session.messageApp === "WhatsApp"
          ? undefined
          : REFERENCE_CONFIRM_KEYBOARD
    }
  );
  return true;
}

export const suivreFromJOReference = async (
  session: ISession
): Promise<void> => {
  try {
    await session.log({ event: "/follow-reference" });
    await askReferenceQuestion(session);
  } catch (error) {
    console.log(error);
  }
};
