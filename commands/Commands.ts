import { CommandType, ISession } from "../types.ts";

import {
  followOrganisationTelegram,
  searchOrganisationFromStr,
  followOrganisationsFromWikidataIdStr
} from "./followOrganisation.ts";
import {
  followCommand,
  fullHistoryCommand,
  manualFollowCommand,
  searchCommand,
  searchPersonHistory
} from "./search.ts";
import { enaCommand, promosCommand, suivreFromJOReference } from "./ena.ts";
import { statsCommand } from "./stats.ts";
import { defaultCommand } from "./default.ts";
import { startCommand } from "./start.ts";
import { deleteProfileCommand } from "./deleteProfile.ts";
import {
  followFunctionCommand,
  followFunctionFromStrCommand
} from "./followFunction.ts";
import { listCommand, unfollowFromStr } from "./list.ts";
import { KEYBOARD_KEYS } from "../entities/Keyboard.ts";
import {
  clearFollowUp,
  handleFollowUpMessage
} from "../entities/FollowUpManager.ts";

export async function processMessage(
  session: ISession,
  msg: string
): Promise<void> {
  // remove all spaces and replace them with a single space
  const cleanMsg = msg.trim().replace(/ +/g, " ");

  if (session.isReply) return;

  // Look through all keyboard keys to find a match
  for (const keyboardKey of Object.values(KEYBOARD_KEYS)) {
    const buttonText = keyboardKey.key.text;

    // Check for an exact match
    if (buttonText === cleanMsg) {
      // We found a matching keyboard button, execute its action
      clearFollowUp(session);
      await keyboardKey.action(session, cleanMsg);
      return;
    }
  }

  for (const command of commands) {
    if (command.regex.test(cleanMsg)) {
      clearFollowUp(session);
      await command.action(session, cleanMsg);
      return;
    }
  }

  if (await handleFollowUpMessage(session, cleanMsg)) return;

  await defaultCommand(session);
}

export const commands: CommandType[] = [
  {
    regex: /^\/start$|^Bonjour /i,
    action: startCommand
  },
  {
    regex: /^Rechercher$|^Recherche$/i,
    action: searchCommand
  },
  {
    regex: /^🧐 Mes suivis$|^Suivis$|^Suivi$/i,
    action: listCommand
  },
  {
    regex: /^🕵️ Forcer le suivi de \s*(.*)/i,
    action: (session, msg) =>
      manualFollowCommand(
        session,
        "SuivreN " + msg.split(" ").slice(5).join(" ")
      )
  },
  {
    regex:
      /^SuivreR|^SuiviR|^Suivre R |^Suivi R |^Suivre R$|^Suivi R$|^Suivre à partir d'une référence JORF\/BO/i,
    action: suivreFromJOReference
  },
  {
    regex: /^SuivreN|^SuiviN/i,
    action: manualFollowCommand
  },
  {
    regex: /^Suivre N |^Suivre N$|^Suivi N |^Suivi N$/i,
    action: (session, msg) =>
      manualFollowCommand(
        session,
        "SuivreN " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /^Suivre une fonction|^Fonction$/i,
    action: followFunctionCommand
  },
  {
    regex: /^SuivreF|^SuiviF|^RechercherF|^RechercheF/i,
    action: followFunctionFromStrCommand
  },
  {
    regex:
      /^Suivre F |^Suivre F$|^Suivi F |^Suivi F$|^Rechercher F |^Rechercher F$|^Recherche F |^Recherche F$/i,
    action: (session, msg) =>
      followFunctionFromStrCommand(
        session,
        "SuivreF " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /^SuivreO|^SuiviO/i,
    action: followOrganisationsFromWikidataIdStr
  },
  {
    regex: /^Suivre O |^Suivre O$|^Suivi O |^Suivi O$/i,
    action: (session, msg) =>
      followOrganisationsFromWikidataIdStr(
        session,
        "SuivreO " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /^Rechercher O |^Rechercher O$|^Recherche O |^Recherche O$/i,
    action: (session, msg) =>
      searchOrganisationFromStr(
        session,
        "RechercherO " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /^RechercherO|^RechercheO/i,
    action: searchOrganisationFromStr
  },
  {
    regex: /^Suivre|^Suivi/i,
    action: followCommand
  },
  {
    regex: /^Retirer \s*(.*)/i,
    action: unfollowFromStr
  },
  {
    regex: /^Historique complet de \s*(.*)/i,
    action: (session, msg) =>
      fullHistoryCommand(
        session,
        "Historique " + msg.split(" ").slice(3).join(" ")
      )
  },
  {
    regex: /^Historique de \s*(.*)/i,
    action: (session, msg) =>
      fullHistoryCommand(
        session,
        "Historique " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /Historique \s*(.*)/i,
    action: fullHistoryCommand
  },
  {
    regex: /^Rechercher \s*(.*)|^Recherche /i,
    action: (session, msg) => searchPersonHistory(session, msg, "latest").then()
  },
  {
    regex: /^\/promos/i,
    action: promosCommand
  },
  {
    regex: /^\/secret$|^\/ENA$|^\/INSP$|^ENA$|^INSP$/i,
    action: enaCommand
  },
  {
    regex: /^\/stats|^stats/i,
    action: statsCommand
  },
  {
    regex:
      /^🏛️️ Ajouter une organisation|^\/followOrganisation|^\/followOrganization|^🏛️️ Ajout Organisation/i,
    action: followOrganisationTelegram
  },
  {
    regex: /^\/supprimerCompte/i,
    action: deleteProfileCommand
  }
];
