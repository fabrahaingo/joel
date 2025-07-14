import { CommandType } from "../types.ts";

import { followOrganisationCommand } from "./followOrganisation.ts";
import {
  followCommand,
  fullHistoryCommand,
  manualFollowCommand,
  searchCommand
} from "./search.ts";
import { enaCommand, promosCommand } from "./ena.ts";
import { statsCommand } from "./stats.ts";
import { defaultCommand } from "./default.ts";
import { startCommand } from "./start.ts";
import { deleteProfileCommand } from "./deleteProfile.ts";
import { helpCommand } from "./help.ts";
import { followFunctionCommand } from "./followFunction.ts";
import { listCommand, unfollowCommand } from "./list.ts";

export const commands: CommandType[] = [
  {
    regex: /\/start$|🏠 Menu principal/,
    action: startCommand
  },
  {
    regex: /🔎 Rechercher$|🔎 Nouvelle recherche$/,
    action: searchCommand
  },
  {
    regex: /🕵️ Forcer le suivi de \s*(.*)/i,
    action: manualFollowCommand
  },
  {
    regex: /Historique de \s*(.*)/i,
    action: fullHistoryCommand
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
    regex: /🧐 Lister mes suivis$/,
    action: listCommand
  },
  {
    regex: /❓ Aide/,
    action: helpCommand
  },
  {
    regex: /👨‍💼 Ajouter une fonction/,
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
      /🏛️️ Ajouter une organisation|\/followOrganisation|\/followOrganization/i,
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
