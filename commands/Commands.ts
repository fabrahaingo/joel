import { CommandType } from "../types.ts";

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
import { defaultCommand, mainMenuCommand } from "./default.ts";
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
    regex: /^\/start$|^Bonjour /i,
    action: startCommand
  },
  {
    regex: /^🏠 Menu principal|^🔎 Commandes/i,
    action: mainMenuCommand
  },
  {
    regex: /^Rechercher$|^Recherche$|^🔎 Rechercher$|^🔎 Nouvelle recherche$/i,
    action: searchCommand
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
      /^SuivreR|^SuiviR|^Suivre R|^Suivi R|^Suivre à partir d'une référence JORF\/BO/i,
    action: suivreFromJOReference
  },
  {
    regex: /^SuivreN|^SuiviN/i,
    action: manualFollowCommand
  },
  {
    regex: /^Suivre N|^Suivi N/i,
    action: (session, msg) =>
      manualFollowCommand(
        session,
        "SuivreN " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex:
      /^👨‍💼 Ajouter une fonction|^👨‍💼 Ajout Fonction|^Suivre une fonction|^Fonction$/i,
    action: followFunctionCommand
  },
  {
    regex: /^SuivreF|^SuiviF|^RechercherF|^RechercheF/i,
    action: followFunctionFromStrCommand
  },
  {
    regex: /^Suivre F|^Suivi F|^Rechercher F|^Recherche F/i,
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
    regex: /^Suivre O|^Suivi O/i,
    action: (session, msg) =>
      followOrganisationsFromWikidataIdStr(
        session,
        "SuivreO " + msg.split(" ").slice(2).join(" ")
      )
  },
  {
    regex: /^Rechercher O|^Recherche O/i,
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
    regex: /^✋ Retirer un suivi$/i,
    action: unfollowTelegram
  },
  {
    regex: /^Retirer \s*(.*)/i,
    action: unfollowFromStr
  },
  {
    regex: /^🧐 Lister mes suivis$|^🧐 Mes suivis$|^Suivis$/i,
    action: listCommand
  },
  {
    regex: /^❓ Aide|^❓ Aide & Contact/i,
    action: helpCommand
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
    regex: /^\/promos|^Liste des promos ENA\/INSP/i,
    action: promosCommand
  },
  {
    regex: /^\/secret|^\/ENA|^\/INSP|^Rechercher une promo ENA\/INSP/i,
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
  },
  {
    regex: /.*/,
    action: defaultCommand
  }
];
