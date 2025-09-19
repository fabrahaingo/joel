import User from "../models/User.ts";
import People from "../models/People.ts";
import { IPeople, ISession, WikidataId } from "../types.ts";
import {
  List_Promos_INSP_ENA,
  Promo_ENA_INSP
} from "../entities/PromoNames.ts";
import TelegramBot from "node-telegram-bot-api";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";
import {
  callJORFSearchOrganisation,
  callJORFSearchReference,
  callJORFSearchTag,
  cleanPeopleName
} from "../utils/JORFSearch.utils.ts";
import {
  extractTelegramSession,
  TelegramSession
} from "../entities/TelegramSession.ts";
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
  "Formats acceptés:\nGeorges-Clemenceau\n2017-2018\n" +
  "Utilisez la command /promos pour consulter la liste des promotions INSP et ENA disponibles.";

const PROMO_SEARCH_KEYBOARD: Keyboard = [
  [KEYBOARD_KEYS.ENA_INSP_PROMO_SEARCH.key],
  [KEYBOARD_KEYS.ENA_INSP_PROMO_LIST.key],
  [KEYBOARD_KEYS.MAIN_MENU.key]
];

const PROMO_CONFIRM_KEYBOARD: Keyboard = [
  [
    { text: "Oui" },
    { text: "Non" }
  ],
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
  await askFollowUpQuestion(session, PROMO_PROMPT_TEXT, handlePromoAnswer, {
    keyboard: PROMO_SEARCH_KEYBOARD
  });
}

async function handlePromoAnswer(
  session: ISession,
  answer: string,
  _context: void
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

  if (/^\/promos/i.test(trimmedAnswer)) {
    await promosCommand(session);
    await askPromoQuestion(session);
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  const promoInfo = findENAINSPPromo(trimmedAnswer);

  if (promoInfo && !promoInfo.onJORF) {
    const promoStr = promoInfo.name
      ? `${promoInfo.name} (${promoInfo.period})`
      : promoInfo.period;

    await session.sendMessage(
      `La promotion *${promoStr}* n'est pas disponible dans les archives du JO car elle est trop ancienne.\n` +
        "Utilisez la commande /promos pour consulter la liste des promotions INSP et ENA disponibles.",
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
    await session.sendMessage(
      `La promotion n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.\n\n` +
        "Utilisez la commande /promos pour consulter la liste des promotions INSP et ENA disponibles.",
      PROMO_SEARCH_KEYBOARD
    );
    await askPromoQuestion(session);
    return true;
  }

  const promoStr = promoInfo.name
    ? `${promoInfo.name} (${promoInfo.period})`
    : promoInfo.period;

  await session.sendMessage(
    `La promotion *${promoStr}* contient *${String(promoJORFList.length)} élèves*:`
  );

  promoJORFList.sort((a, b) => {
    if (a.nom.toUpperCase() < b.nom.toUpperCase()) return -1;
    if (a.nom.toUpperCase() > b.nom.toUpperCase()) return 1;
    return 0;
  });

  const contacts = promoJORFList.map((contact) => {
    return `${contact.nom} ${contact.prenom}`;
  });
  if (contacts.length > 0) {
    await session.sendMessage(contacts.join("\n"));
  }

  await askFollowUpQuestion(session, PROMO_CONFIRM_TEXT, handlePromoConfirmation, {
    context: {
      promoInfo,
      promoJORFList,
      promoLabel: promoStr
    },
    keyboard: PROMO_CONFIRM_KEYBOARD
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
    await askFollowUpQuestion(session, PROMO_CONFIRM_TEXT, handlePromoConfirmation, {
      context,
      keyboard: PROMO_CONFIRM_KEYBOARD
    });
    return true;
  }

  if (trimmedAnswer.startsWith("/")) {
    return false;
  }

  if (/oui/i.test(trimmedAnswer)) {
    await session.sendMessage(`Ajout en cours... ⏰`);
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
  await askFollowUpQuestion(session, PROMO_CONFIRM_TEXT, handlePromoConfirmation, {
    context,
    keyboard: PROMO_CONFIRM_KEYBOARD
  });
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

    text +=
      "Utilisez la commande /ENA ou /INSP pour suivre la promotion de votre choix.\n\n";

    await session.sendMessage(text);
  } catch (error) {
    console.log(error);
  }
};

export const suivreFromJOReference = async (
  session: ISession
): Promise<void> => {
  try {
    await session.log({ event: "/follow-reference" });

    const tgSession: TelegramSession | undefined = await extractTelegramSession(
      session,
      true
    );
    if (tgSession == null) return;
    const tgBot = tgSession.telegramBot;

    const text = `Entrez la référence JORF/BO et l'*intégralité des personnes mentionnées* sera ajoutée à la liste de vos contacts.\n
⚠️ Attention, un nombre important de suivis seront ajoutés en même temps, *les retirer peut ensuite prendre du temps* ⚠️\n
Format: *JORFTEXT000052060473*`;
    const question = await tgBot.sendMessage(tgSession.chatIdTg, text, {
      parse_mode: "Markdown",
      reply_markup: {
        force_reply: true
      }
    });
    tgBot.onReplyToMessage(
      tgSession.chatIdTg,
      question.message_id,
      (tgMsg1: TelegramBot.Message) => {
        void (async () => {
          const temp_keyboard: Keyboard = [
            [KEYBOARD_KEYS.REFERENCE_FOLLOW.key],
            [KEYBOARD_KEYS.MAIN_MENU.key]
          ];
          if (tgMsg1.text == undefined || tgMsg1.text.length == 0) {
            await session.sendMessage(
              `Votre réponse n'a pas été reconnue.👎\nVeuillez essayer de nouveau la commande.`,
              temp_keyboard
            );
            return;
          }

          const ref = tgMsg1.text.trim().toUpperCase();

          const JORFResult = await callJORFSearchReference(ref);

          if (JORFResult.length == 0) {
            const message = `La référence n'a pas été pas été reconnue.👎\nVeuillez essayer de nouveau la commande.`;

            await session.sendMessage(message, [temp_keyboard]);
            return;
          }

          await session.sendMessage(
            `Le texte *${ref}* mentionne *${String(JORFResult.length)} personnes*:`
          );

          // sort JORFSearchRes by the upper lastname: to account for French "particule"
          JORFResult.sort((a, b) => {
            if (a.nom.toUpperCase() < b.nom.toUpperCase()) return -1;
            if (a.nom.toUpperCase() > b.nom.toUpperCase()) return 1;
            return 0;
          });
          // send all contacts
          const contacts = JORFResult.map((contact) => {
            return `${contact.nom} ${contact.prenom}`;
          });
          await session.sendMessage(contacts.join("\n"));
          const followConfirmation = await tgBot.sendMessage(
            tgSession.chatIdTg,
            `Voulez-vous ajouter ces personnes à vos suivis ? (répondez *oui* ou *non*)\n\n⚠️ Attention : *les retirer peut ensuite prendre du temps*`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                force_reply: true
              }
            }
          );
          tgBot.onReplyToMessage(
            tgSession.chatIdTg,
            followConfirmation.message_id,
            (tgMsg2: TelegramBot.Message) => {
              void (async () => {
                if (tgMsg2.text != undefined) {
                  if (new RegExp(/oui/i).test(tgMsg2.text)) {
                    await session.sendMessage(`Ajout en cours... ⏰`);
                    await session.sendTypingAction();
                    session.user ??= await User.findOrCreate(session);

                    const peopleTab: IPeople[] = [];

                    for (const contact of JORFResult) {
                      const people = await People.findOrCreate({
                        nom: contact.nom,
                        prenom: contact.prenom
                      });
                      peopleTab.push(people);
                    }
                    await session.user.addFollowedPeopleBulk(peopleTab);
                    await session.user.save();
                    await session.sendMessage(
                      `Les *${String(
                        peopleTab.length
                      )} personnes* ont été ajoutées à vos contacts.`
                    );
                    return;
                  } else if (new RegExp(/non/i).test(tgMsg2.text)) {
                    await session.sendMessage(
                      `Ok, aucun ajout n'a été effectué. 👌`
                    );
                    return;
                  }
                }
                await session.sendMessage(
                  `Votre réponse n'a pas été reconnue. 👎\nVeuillez essayer de nouveau la commande.`,
                  temp_keyboard
                );
              })();
            }
          );
        })();
      }
    );
  } catch (error) {
    console.log(error);
  }
};
