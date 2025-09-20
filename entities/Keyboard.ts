import { ISession } from "../types";

export interface KeyboardKey {
  text: string;
  desc?: string;
}
export type Keyboard = KeyboardKey[][] | undefined;

export const KEYBOARD_KEYS: Record<
  string,
  {
    key: KeyboardKey;
    action?: (session: ISession, msg?: string) => Promise<void>;
  }
> = {
  MAIN_MENU: {
    key: { text: "🏠 Menu principal" },
    action: async (session: ISession, _msg?: string) => {
      const { mainMenuCommand } = await import("../commands/default.ts");
      await mainMenuCommand(session);
    }
  },
  COMMAND_LIST: {
    key: { text: "🔎 Commandes" },
    action: async (session: ISession, _msg?: string) => {
      const { mainMenuCommand } = await import("../commands/default.ts");
      await mainMenuCommand(session);
    }
  },
  PEOPLE_SEARCH: {
    key: { text: "🔎 Rechercher" },
    action: async (session: ISession, _msg?: string) => {
      const { searchCommand } = await import("../commands/search.ts");
      await searchCommand(session);
    }
  },
  PEOPLE_SEARCH_NEW: {
    key: { text: "🔎 Nouvelle recherche" },
    action: async (session: ISession, _msg?: string) => {
      const { searchCommand } = await import("../commands/search.ts");
      await searchCommand(session);
    }
  },
  ENA_INSP_PROMO_SEARCH: {
    key: { text: "Ajouter promo INSP" },
    action: async (session: ISession, _msg?: string) => {
      const { enaCommand } = await import("../commands/ena.ts");
      await enaCommand(session);
    }
  },
  ENA_INSP_PROMO_LIST: {
    key: { text: "Liste promos INSP" },
    action: async (session: ISession, _msg?: string) => {
      const { promosCommand } = await import("../commands/ena.ts");
      await promosCommand(session);
    }
  },
  FUNCTION_FOLLOW: {
    key: { text: "👨‍💼 Ajout fonction" },
    action: async (session: ISession, _msg?: string) => {
      const { followFunctionCommand } = await import(
        "../commands/followFunction.ts"
      );
      await followFunctionCommand(session);
    }
  },
  ORGANISATION_FOLLOW: {
    key: { text: "🏛️️ Ajouter une organisation" },
    action: async (session: ISession, _msg?: string) => {
      const { followOrganisationTelegram } = await import(
        "../commands/followOrganisation.ts"
      );
      await followOrganisationTelegram(session);
    }
  },
  REFERENCE_FOLLOW: {
    key: { text: "Suivre à partir d'une référence JORF/BO" },
    action: async (session: ISession, _msg?: string) => {
      const { suivreFromJOReference } = await import("../commands/ena.ts");
      await suivreFromJOReference(session);
    }
  },
  FOLLOWS_LIST: {
    key: { text: "🧐 Mes suivis" },
    action: async (session: ISession, _msg?: string) => {
      const { listCommand } = await import("../commands/list.ts");
      await listCommand(session);
    }
  },
  FOLLOWS_REMOVE: {
    key: { text: "👨✋ Retirer un suivi" },
    action: async (session: ISession, _msg?: string) => {
      const { unfollowCommand } = await import("../commands/list.ts");
      await unfollowCommand(session);
    }
  },
  HELP: {
    key: { text: "❓ Aide" },
    action: async (session: ISession, _msg?: string) => {
      const { helpCommand } = await import("../commands/help.ts");
      await helpCommand(session);
    }
  },
  FOLLOW_UP_FOLLOW: {
    key: { text: "Suivre" }
  },
  FOLLOW_UP_FOLLOW_MANUAL: {
    key: { text: "🕵️ Suivi manuel" }
  },
  FOLLOW_UP_HISTORY: {
    key: { text: "Historique" }
  }
};
