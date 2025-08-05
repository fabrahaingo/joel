import { CommandType } from "../types.ts";

import {
  followOrganisationTelegram,
  searchOrganisationFromStr,
  followOrganisationsFromWikidataIdStr
} from "./followOrganisation.ts";
import {
  followCommand,
  fullHistoryCommand,
  fullHistoryCommandLong,
  manualFollowCommandLong,
  manualFollowCommandShort,
  searchCommand
} from "./search.ts";
import { enaCommand, promosCommand } from "./ena.ts";
import { statsCommand } from "./stats.ts";
import { defaultCommand, showCommands } from "./default.ts";
import { startCommand } from "./start.ts";
import { deleteProfileCommand } from "./deleteProfile.ts";
import { helpCommand } from "./help.ts";
import {
  followFunctionCommand,
  followFunctionFromStrCommand
} from "./followFunction.ts";
import { listCommand, unfollowFromStr, unfollowTelegram } from "./list.ts";

export const commands: CommandType[] = [
  {
    regex: /\/start$|🏠 Menu principal/i,
    action: startCommand
  },
  {
    regex: /🔎 Commandes$/i,
    action: showCommands
  },
  {
    regex: /Rechercher$|🔎 Rechercher$|🔎 Nouvelle recherche$/i,
    action: searchCommand
  },
  {
    regex: /🕵️ Forcer le suivi de \s*(.*)/i,
    action: manualFollowCommandLong
  },
  {
    regex: /SuivreN/i,
    action: manualFollowCommandShort
  },
  {
    regex:
      /👨‍💼 Ajouter une fonction|👨‍💼 Ajout Fonction|Suivre une fonction|Fonctions|Fonction$/i,
    action: followFunctionCommand
  },
  {
    regex: /SuivreF \s*(.*)/i,
    action: followFunctionFromStrCommand
  },
  {
    regex: /Suivre \s*(.*)/i,
    action: followCommand
  },
  {
    regex: /✋ Retirer un suivi$/i,
    action: unfollowTelegram
  },
  {
    regex: /Retirer \s*(.*)/i,
    action: unfollowFromStr
  },
  {
    regex: /🧐 Lister mes suivis$|🧐 Mes suivis$|Suivis$/i,
    action: listCommand
  },
  {
    regex: /❓ Aide|❓ Aide & Contact/i,
    action: helpCommand
  },
  {
    regex: /Historique complet de \s*(.*)/i,
    action: fullHistoryCommandLong
  },
  {
    regex: /Rechercher \s*(.*)|Historique \s*(.*)/i,
    action: fullHistoryCommand
  },
  {
    regex: /\/promos|Liste des promos ENA\/INSP/i,
    action: promosCommand
  },
  {
    regex: /\/secret|\/ENA|\/INSP|Rechercher une promo ENA\/INSP/i,
    action: enaCommand
  },
  {
    regex: /\/stats/i,
    action: statsCommand
  },
  {
    regex:
      /🏛️️ Ajouter une organisation|\/followOrganisation|\/followOrganization|🏛️️ Ajout Organisation/i,
    action: followOrganisationTelegram
  },
  {
    regex: /RechercherO \s*(.*)/i,
    action: searchOrganisationFromStr
  },
  {
    regex: /SuivreO \s*(.*)/i,
    action: followOrganisationsFromWikidataIdStr
  },
  {
    regex: /\/supprimerCompte/i,
    action: deleteProfileCommand
  },
  {
    regex: /.*/,
    action: defaultCommand
  }
];
