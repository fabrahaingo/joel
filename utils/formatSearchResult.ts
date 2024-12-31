import { textTypeOrdre } from "./formatting.utils";
import { dateToFrenchString } from "./date.utils";

function addPoste(
  elem: {
    organisations: { nom: any }[];
    ministre: any;
    cabinet: string;
    inspecteur_general: any;
    grade: any;
    armee: any;
    corps: any;
    armee_grade: any;
    type_ordre: any;
    ordre_merite: any;
    legion_honneur: any;
    nomme_par: any;
    autorite_delegation: any;
  },
  message: string
) {
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
    if (elem.organisations && elem.organisations[0]?.nom) {
      message += `\n🪖 *${elem.organisations[0].nom}*\n`;
    } else {
      message += `\n🪖 *${elem.corps}*\n`;
    }
  } else if (elem.cabinet) {
    message += `👉 Cabinet du *${elem.cabinet}*\n`;
  } else if (elem.organisations[0]?.nom) {
    message += `*👉 ${elem.organisations[0].nom}*\n`;
  } else if (elem.ministre) {
    message += `*👉 ${elem.ministre}*\n`;
  } else if (elem.inspecteur_general) {
    message += `*👉 Inspecteur général des ${elem.inspecteur_general}*\n`;
  } else if (elem.autorite_delegation) {
    message += `👉 par le _${elem.autorite_delegation}_\n`;
  } else if (elem.corps) {
    message += `👉 Corps des ${elem.corps}\n`;
  }
  return message;
}

function addLinkJO(
  elem: { source_id: any; source_name: any; source_date: any },
  message: string
) {
  if (elem.source_id && elem.source_date) {
    message += `🔗 _JO du ${dateToFrenchString(elem.source_date)}_: `;

    switch (elem.source_name) {
      case "BOMI":
        message += `[cliquez ici](https://bodata.steinertriples.ch/${elem.source_id}.pdf)\n`;
        break;
      default:
        message += `[cliquez ici](https://www.legifrance.gouv.fr/jorf/id/${elem.source_id})\n`;
    }
  }
  return message;
}

export function formatSearchResult(
  result: string | any[],
  options?: {
    isConfirmation: any;
    isListing?: any;
    displayName?: any;
  }
) {
  let message = "";
  let prenomNom = `${result[0].prenom} ${result[0].nom}`;
  let prenomNomLink = `[${prenomNom}](https://jorfsearch.steinertriples.ch/name/${encodeURI(
    prenomNom
  )})`;
  if (options?.isConfirmation) {
    if (result.length === 1)
      message += `Voici la dernière information que nous avons sur ${prenomNomLink}.\n\n`;
    else
      message += `Voici les ${result.length} dernières informations que nous avons sur ${prenomNomLink}.\n\n`;
  } else if (!options?.isListing) {
    message += `Voici la liste des postes connus pour ${prenomNomLink}:\n\n`;
  }
  for (let elem of result) {
    if (options?.displayName) {
      message += `🕵️ *${elem.prenom} ${elem.nom}*\n`;
    }
    message += textTypeOrdre(elem.type_ordre || "nomination", elem.sexe || "M");
    message = addPoste(elem, message);

    if (elem?.date_debut) {
      if (
        elem.type_ordre === "nomination" &&
        (elem?.armee_grade || elem?.grade)
      ) {
        message += `🗓 Pour prendre rang du ${dateToFrenchString(
          elem.date_debut
        )}\n`;
      } else {
        if (elem?.date_fin)
          message += `🗓 Du ${dateToFrenchString(
            elem.date_debut
          )} au ${dateToFrenchString(elem.date_fin)}\n`;
        else {
          message += `🗓 À compter du ${dateToFrenchString(elem.date_debut)}\n`;
        }
      }
    } else if (elem?.date_fin) {
      message += `🗓 Jusqu'au ${dateToFrenchString(elem.date_fin)}\n`;
    }
    message = addLinkJO(elem, message);
    message += "\n";
  }
  return message;
}
