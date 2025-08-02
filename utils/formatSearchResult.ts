import { textTypeOrdre } from "./formatting.utils.ts";
import { dateToFrenchString } from "./date.utils.ts";
import { JORFSearchItem } from "../entities/JORFSearchResponse.ts";

function addPoste(elem: JORFSearchItem, message: string) {
  if (elem.grade) {
    message += `👉 au grade de *${elem.grade}*`;
    if (elem.ordre_merite) {
      message += ` de l'Ordre national du mérite\n`;
    } else if (elem.legion_honneur) {
      message += ` de la Légion d'honneur\n`;
    } else {
      message += `\n`;
    }
    if (elem.nomme_par) {
      message += `🏛️ par le *${elem.nomme_par}*\n`;
    } else if (elem.cabinet) {
      message += `🏛️ Cabinet du *${elem.cabinet}*\n`;
    }
  } else if (elem.armee_grade) {
    if (elem.type_ordre == "nomination") {
      message += `👉 au grade de *${elem.armee_grade}*`;
    } else if (elem.type_ordre == "promotion") {
      message += `👉 au grade de *${elem.armee_grade}* (TA)`;
    }
    if (elem.armee === "réserve") {
      message += ` de réserve`;
    }
    if (elem.organisations[0]?.nom) {
      message += `\n🪖 *${elem.organisations[0].nom}*\n`;
    } else if (elem.corps) {
      message += `\n🪖 *${elem.corps}*\n`;
    }
  } else if (elem.cabinet) {
    message += `🏛️ Cabinet du *${elem.cabinet}*\n`;
  } else if (elem.ambassadeur) {
    const ambassadePoste = elem.organisations[0]?.nom ?? elem.ambassadeur_pays;
    if (ambassadePoste)
      message += `🏛️ Ambassadeur auprès de *${ambassadePoste}*\n`;
    else message += `🏛️ Ambassadeur\n`;
  } else if (elem.organisations[0]?.nom) {
    message += `*👉 ${elem.organisations[0].nom}*\n`;
  } else if (elem.ministre) {
    message += `*👉 ${elem.ministre}*\n`;
  } else if (elem.inspecteur_general) {
    message += `*👉 Inspecteur général ${elem.inspecteur_general}*\n`;
  } else if (elem.autorite_delegation) {
    message += `👉 par le _${elem.autorite_delegation}_\n`;
  } else if (elem.corps) {
    message += `👉 Corps des ${elem.corps}\n`;
  }
  return message;
}

export function formatSearchResult(
  result: JORFSearchItem[],
  markdownLink: boolean,
  options?: {
    isConfirmation?: boolean;
    isListing?: boolean;
    displayName?: "all" | "first" | "no";
  }
) {
  let message = "";
  for (const elem of result) {
    const prenomNom = `${elem.prenom} ${elem.nom}`;
    const url = `https://jorfsearch.steinertriples.ch/name/${encodeURI(
      prenomNom
    )}`;

    const prenomNomLink = markdownLink
      ? `[${prenomNom}](${url})`
      : `*${prenomNom}*\n${url}\n`;

    if (result.indexOf(elem) == 0) {
      if (options?.isConfirmation) {
        if (result.length === 1)
          message += `Voici la dernière information que nous avons sur ${prenomNomLink}.\n\n`;
        else
          message += `Voici les ${String(result.length)} dernières informations que nous avons sur ${prenomNomLink}.\n\n`;
      } else if (!options?.isListing) {
        message += `Voici la liste des postes connus pour ${prenomNomLink}\n\n`;
      } else if (options.displayName === "first") {
        message += `🕵️ ${prenomNomLink}\n\n`;
      }
    }
    if (options?.displayName === "all") {
      message += `🕵️ ${prenomNomLink}\n`;
    }
    message += textTypeOrdre(elem.type_ordre, elem.sexe ?? "M");
    message = addPoste(elem, message);

    if (elem.date_debut) {
      if (
        elem.type_ordre === "nomination" &&
        (elem.armee_grade || elem.grade)
      ) {
        message += `🗓 Pour prendre rang du ${dateToFrenchString(
          elem.date_debut
        )}\n`;
      } else {
        if (elem.date_fin)
          message += `🗓 Du ${dateToFrenchString(
            elem.date_debut
          )} au ${dateToFrenchString(elem.date_fin)}\n`;
        else {
          message += `🗓 À compter du ${dateToFrenchString(elem.date_debut)}\n`;
        }
      }
    } else if (elem.date_fin) {
      message += `🗓 Jusqu'au ${dateToFrenchString(elem.date_fin)}\n`;
    }
    if (elem.source_id && elem.source_date) {
      message += `🔗 _${elem.source_name} du ${dateToFrenchString(elem.source_date)}_: `;
      if (markdownLink)
        message += `[cliquez ici](https://bodata.steinertriples.ch/${elem.source_id}/redirect)\n`;
      else
        message += `\nhttps://bodata.steinertriples.ch/${elem.source_id}/redirect\n`;
    }

    message += "\n";
  }
  return message;
}
