import { mainMenuCommand } from "../commands/default.ts";
import { listCommand, unfollowTelegram } from "../commands/list.ts";
import { searchCommand } from "../commands/search.ts";
import { helpCommand } from "../commands/help.ts";
import { ISession } from "../types";
import {
  enaCommand,
  promosCommand,
  suivreFromJOReference
} from "../commands/ena.ts";
import { followFunctionCommand } from "../commands/followFunction.ts";
import { followOrganisationTelegram } from "../commands/followOrganisation.ts";

export interface KeyboardKey {
  text: string;
  desc?: string;
}
export type Keyboard = KeyboardKey[][] | undefined;

export const KEYBOARD_KEYS: Record<
  string,
  {
    key: KeyboardKey;
    action: (session: ISession, msg?: string) => Promise<void>;
  }
> = {
  MAIN_MENU: { key: { text: "🏠 Menu principal" }, action: mainMenuCommand },
  COMMAND_LIST: { key: { text: "🔎 Commandes" }, action: mainMenuCommand },
  PEOPLE_SEARCH: { key: { text: "🔎 Rechercher" }, action: searchCommand },
  PEOPLE_SEARCH_NEW: {
    key: { text: "🔎 Nouvelle recherche" },
    action: searchCommand
  },
  ENA_INSP_PROMO_SEARCH: {
    key: { text: "Rechercher une promo ENA/INSP" },
    action: enaCommand
  },
  ENA_INSP_PROMO_LIST: {
    key: { text: "Liste des promos ENA/INSP" },
    action: promosCommand
  },
  FUNCTION_FOLLOW: {
    key: { text: "👨‍💼 Ajout fonction" },
    action: followFunctionCommand
  },
  ORGANISATION_FOLLOW: {
    key: { text: "🏛️️ Ajouter une organisation" },
    action: followOrganisationTelegram
  },
  REFERENCE_FOLLOW: {
    key: { text: "Suivre à partir d'une référence JORF/BO" },
    action: suivreFromJOReference
  },
  FOLLOWS_LIST: { key: { text: "🧐 Mes suivis" }, action: listCommand },
  FOLLOWS_REMOVE: {
    key: { text: "👨✋ Retirer un suivi" },
    action: unfollowTelegram
  },
  HELP: { key: { text: "❓ Aide" }, action: helpCommand }
};
