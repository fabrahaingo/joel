import { CommandType } from "../types.ts";

import { followOrganisationCommand } from "./followOrganisation.ts";
import {
  followCommand,
  fullHistoryCommand,
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
import { listCommand, unfollowCommand } from "./list.ts";

export const commands: CommandType[] = [
  {
    regex: /\/start$|🏠 Menu principal/,
    action: startCommand
  },
  {
    regex: /🔎 Commandes$/,
    action: showCommands
  },
  {
    regex: /Rechercher$|🔎 Rechercher$|🔎 Nouvelle recherche$/,
    action: searchCommand
  },
  {
    regex: /🕵️ Forcer le suivi de \s*(.*)/i,
    action: manualFollowCommandLong
  },
  {
    regex: /SuivreN \s*(.*)/i,
    action: manualFollowCommandShort
  },
  {
    regex: /Rechercher \s*(.*)|Historique \s*(.*)/i,
    action: fullHistoryCommand
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
    regex: /✋ Retirer un suivi$/,
    action: unfollowCommand
  },
  {
    regex: /🧐 Lister mes suivis$|🧐 Mes suivis$/,
    action: listCommand
  },
  {
    regex: /❓ Aide|❓ Aide & Contact/,
    action: helpCommand
  },
  {
    regex: /👨‍💼 Ajouter une fonction|👨‍💼 Ajout Fonction/,
    action: followFunctionCommand
  },
  {
    regex: /\/secret|\/ENA|\/INSP/i,
    action: enaCommand
  },
  {
    regex: /\/promos/,
    action: promosCommand
  },
  {
    regex: /\/stats/,
    action: statsCommand
  },
  {
    regex:
      /🏛️️ Ajouter une organisation|\/followOrganisation|\/followOrganization|🏛️️ Ajout Organisation/i,
    action: followOrganisationCommand
  },
  {
    regex: /\/supprimerCompte/,
    action: deleteProfileCommand
  },
  {
    regex: /.*/,
    action: defaultCommand
  }
];
