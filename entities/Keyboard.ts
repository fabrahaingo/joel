import { ISession } from "../types.ts";

export interface KeyboardKey {
  text: string;
  desc?: string;
}
export type Keyboard = KeyboardKey[][];

export const KEYBOARD_KEYS: Record<
  string,
  {
    key: KeyboardKey;
    action?: (session: ISession, msg?: string) => Promise<void>;
  }
> = {
  MAIN_MENU: {
    key: { text: "🏠 Menu principal" },
    action: async (session: ISession) => {
      const { mainMenuCommand } = await import("../commands/default.ts");
      await mainMenuCommand(session);
    }
  },
  PEOPLE_SEARCH: {
    key: { text: "👨‍💼 Nominations" },
    action: async (session: ISession) => {
      const { searchCommand } = await import("../commands/search.ts");
      await searchCommand(session);
    }
  },
  PEOPLE_SEARCH_NEW: {
    key: { text: "👨‍💼 Rechercher" },
    action: async (session: ISession) => {
      const { searchCommand } = await import("../commands/search.ts");
      await searchCommand(session);
    }
  },
  ENA_INSP_PROMO_SEARCH: {
    key: { text: "🎓 Suivre promo INSP" },
    action: async (session: ISession) => {
      const { enaCommand } = await import("../commands/ena.ts");
      await enaCommand(session);
    }
  },
  ENA_INSP_PROMO_SEARCH_LONG_NO_KEYBOARD: {
    key: { text: "🎓 Promotion ENA/INSP" },
    action: async (session: ISession) => {
      const { enaCommand } = await import("../commands/ena.ts");
      await enaCommand(session);
    }
  },
  ENA_INSP_PROMO_LIST: {
    key: { text: "Liste promos INSP" },
    action: async (session: ISession) => {
      const { promosCommand } = await import("../commands/ena.ts");
      await promosCommand(session);
    }
  },
  FUNCTION_FOLLOW: {
    key: { text: "💼 Fonctions" },
    action: async (session: ISession) => {
      const { followFunctionCommand } = await import(
        "../commands/followFunction.ts"
      );
      await followFunctionCommand(session);
    }
  },
  ORGANISATION_FOLLOW: {
    key: { text: "🏛️️ Organisations" },
    action: async (session: ISession) => {
      const { searchOrganisation } = await import(
        "../commands/followOrganisation.ts"
      );
      await searchOrganisation(session);
    }
  },
  ORGANISATION_FOLLOW_NEW: {
    key: { text: "🏛️️ Rechercher" },
    action: async (session: ISession) => {
      const { searchOrganisation } = await import(
        "../commands/followOrganisation.ts"
      );
      await searchOrganisation(session);
    }
  },
  REFERENCE_FOLLOW: {
    key: { text: "📰 Suivre référence" },
    action: async (session: ISession) => {
      const { suivreFromJOReference } = await import("../commands/ena.ts");
      await suivreFromJOReference(session);
    }
  },
  REFERENCE_FOLLOW_NO_KEYBOARD: {
    key: { text: "📰 À partir d'un texte" },
    action: async (session: ISession) => {
      const { suivreFromJOReference } = await import("../commands/ena.ts");
      await suivreFromJOReference(session);
    }
  },
  FOLLOWS_LIST: {
    key: { text: "📋 Mes suivis" },
    action: async (session: ISession) => {
      const { listCommand } = await import("../commands/list.ts");
      await listCommand(session);
    }
  },
  FOLLOWS_REMOVE: {
    key: { text: "👨✋ Retirer un suivi" },
    action: async (session: ISession) => {
      const { unfollowCommand } = await import("../commands/list.ts");
      await unfollowCommand(session);
    }
  },
  DELETE: {
    key: { text: "🗑️ Supprimer compte" },
    action: async (session: ISession) => {
      const { deleteProfileCommand } = await import(
        "../commands/deleteProfile.ts"
      );
      await deleteProfileCommand(session);
    }
  },
  HELP: {
    key: { text: "❓ Aide" },
    action: async (session: ISession) => {
      const { helpCommand } = await import("../commands/help.ts");
      await helpCommand(session);
    }
  },
  STATS: {
    key: { text: "📈 Statistiques" },
    action: async (session: ISession) => {
      const { statsCommand } = await import("../commands/stats.ts");
      await statsCommand(session);
    }
  },
  FOLLOW_UP_FOLLOW: {
    key: { text: "🔎 Suivre" }
  },
  FOLLOW_UP_FOLLOW_MANUAL: {
    key: { text: "🕵️ Suivi manuel" }
  },
  FOLLOW_UP_HISTORY: {
    key: { text: "📖 Historique" }
  }
};
