import { CommandType } from "../types.js";

import { followOrganisationCommand } from "./followOrganisation.js";
import { followCommand, fullHistoryCommand, searchCommand } from "./search.js";
import { enaCommand, promosCommand } from "./ena.js";
import { statsCommand } from "./stats.js";
import { defaultCommand } from "./default.js";
import { startCommand } from "./start.js";
import { deleteProfileCommand } from "./deleteProfile.js";
import { helpCommand } from "./help.js";
import { followFunctionCommand } from "./followFunction.js";
import { listCommand, unfollowCommand } from "./list.js";

export const commands: CommandType[] = [
    {
        regex: /\/start$|🏠 Menu principal/,
        action: startCommand,
    },
    {
        regex: /🔎 Rechercher$|🔎 Nouvelle recherche$/,
        action: searchCommand,
    },
    {
        regex: /Historique de \s*(.*)/i,
        action: fullHistoryCommand,
    },
    {
        regex: /Suivre \s*(.*)/i,
        action: followCommand,
    },
    {
        regex: /✋ Retirer un suivi$/,
        action: unfollowCommand,
    },
    {
        regex: /🧐 Lister mes suivis$/,
        action: listCommand,
    },
    {
        regex: /❓ Aide/,
        action: helpCommand,
    },
    {
        regex: /👨‍💼 Ajouter une fonction/,
        action: followFunctionCommand,
    },
    {
        regex: /\/secret|\/ENA|\/INSP/i,
        action: enaCommand,
    },
    {
        regex: /\/promos/,
        action: promosCommand,
    },
    {
        regex: /\/stats/,
        action: statsCommand,
    },
    {
        regex: /🏛️️ Ajouter une organisation|\/followOrganisation|\/followOrganization/i,
        action: followOrganisationCommand,
    },
    {
        regex: /\/supprimerCompte/,
        action: deleteProfileCommand,
    },
    {
        regex: /.*/,
        action: defaultCommand,
    },
];