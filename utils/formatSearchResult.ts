import { textTypeOrdre, textPublishDate } from "./notification.utils";

function addPoste(
  elem: {
    organisations: { nom: any }[];
    ministre: any;
    inspecteur_general: any;
    grade: any;
    ordre_merite: any;
    legion_honneur: any;
    nomme_par: any;
    autorite_delegation: any;
  },
  message: string
) {
  if (elem.organisations && elem.organisations[0]?.nom) {
    message += `*👉 ${elem.organisations[0].nom}*\n`;
  } else if (elem.ministre) {
    message += `*👉 ${elem.ministre}*\n`;
  } else if (elem.inspecteur_general) {
    message += `*👉 Inspecteur général des ${elem.inspecteur_general}*\n`;
  } else if (elem.grade) {
    message += `👉 au grade de *${elem.grade}*`;
    if (elem.ordre_merite) {
      message += ` de l'Ordre national du mérite`;
    } else if (elem.legion_honneur) {
      message += ` de la Légion d'honneur`;
    }
    message += `${elem.nomme_par ? ` par le _${elem.nomme_par}_` : ""}\n`;
  } else if (elem.autorite_delegation) {
    message += `👉 par le _${elem.autorite_delegation}_\n`;
  }
  return message;
}

function addLinkJO(
  elem: { source_id: any; source_name: any },
  message: string
) {
  if (elem.source_id) {
    switch (elem.source_name) {
      case "BOMI":
        message += `🔗 _Lien JO_:  [cliquez ici](https://bodata.steinertriples.ch/${elem.source_id}.pdf)\n`;
        break;
      default:
        message += `🔗 _Lien JO_:  [cliquez ici](https://www.legifrance.gouv.fr/jorf/id/${elem.source_id})\n`;
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
  if (options?.isConfirmation) {
    if (result.length === 1)
      message += `Voici la dernière information que nous avons sur *${result[0].prenom} ${result[0].nom}*.\n\n`;
    else
      message += `Voici les ${result.length} dernières informations que nous avons sur *${result[0].prenom} ${result[0].nom}*.\n\n`;
  } else if (!options?.isListing) {
    message += `Voici la liste des postes connus pour ${result[0].prenom} ${result[0].nom}:\n\n`;
  }
  for (let elem of result) {
    if (options?.displayName) {
      message += `🕵️ *${elem.prenom} ${elem.nom}*\n`;
    }
    message += textTypeOrdre(elem.type_ordre || "nomination", elem.sexe || "M");
    message = addPoste(elem, message);
    message += textPublishDate(elem.source_date);
    message = addLinkJO(elem, message);
    message += "\n";
  }
  return message;
}
