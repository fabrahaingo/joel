import { CommandType, ISession } from "../types.ts";

import {
  searchOrganisation,
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
import { enaCommand, promosCommand } from "./ena.ts";
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
import { buildInfoCommand } from "./help.ts";
import { exportCommand, importCommand } from "./importExport.ts";
import { sanitizeUserInput } from "../utils/text.utils.ts";
import { textAlertCommand } from "./textAlert.ts";

export async function processMessage(
  session: ISession,
  msg: string
): Promise<void> {
  // remove all spaces and replace them with a single space
  const cleanMsg = sanitizeUserInput(
    msg
      .trim()
      .normalize("NFKC")
      .replace(/ +/g, " ")
      .replace(/[\\~*_\r\n]+/g, "") // replace all markdown artefacts
  );

  const firstLine = cleanMsg.split("\n")[0];

  // Look through all keyboard keys to find a match
  for (const keyboardKey of Object.values(KEYBOARD_KEYS)) {
    const buttonText = keyboardKey.key.text;

    if (firstLine === buttonText) {
      if (
        keyboardKey.keepFollowUpAlive == null ||
        !keyboardKey.keepFollowUpAlive
      )
        clearFollowUp(session);
      if (keyboardKey.action === undefined) continue;
      await keyboardKey.action(session, cleanMsg);
      return;
    }
  }

  if (await handleFollowUpMessage(session, cleanMsg)) return;
  clearFollowUp(session);

  for (const command of commands) {
    if (command.regex.test(cleanMsg)) {
      await command.action(session, cleanMsg);
      return;
    }
  }

  await defaultCommand(session);
}

export const commands: CommandType[] = [
  {
    regex: /^\/start$|^Bonjour /i,
    action: startCommand
  },
  {
    regex: /^\/textAlert/i,
    action: textAlertCommand
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
    action: async (session, msg) => {
      await unfollowFromStr(session, msg);
      return;
    }
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
    regex:
      /^🏛️️ Ajouter une organisation|^\/followOrganisation|^\/followOrganization|^🏛️️ Ajout Organisation/i,
    action: searchOrganisation
  },
  {
    regex: /^\/supprimerCompte|supprimerCompte/i,
    action: deleteProfileCommand
  },
  {
    regex: /^\/export$|^Exporter$|^Export$/i,
    action: exportCommand
  },
  {
    regex: /^\/import$|^Importer$|^Import$/i,
    action: importCommand
  },
  {
    regex: /^\/build|build/i,
    action: buildInfoCommand
  }
];
