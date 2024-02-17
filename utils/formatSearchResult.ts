function addTypeOrdre(
  elem: { type_ordre: any; sexe: string },
  message: string
): string {
  switch (elem.type_ordre) {
    case "nomination":
      message += `📝 A été _nommé${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "réintégration":
      message += `📝 A été _réintégré${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "cessation de fonction":
      message += `📝 A _cessé ses fonctions_ à:\n`;
      break;
    case "affectation":
      message += `📝 A été _affecté${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "délégation de signature":
      message += `📝 A reçu une _délégation de signature_ à:\n`;
      break;
    case "promotion":
      message += `📝 A été _promu${elem.sexe == "F" ? "e" : ""}_:\n`;
      break;
    case "admission":
      message += `📝 A été _admis${elem.sexe == "F" ? "e" : ""}_ \n`;
      break;
    case "inscription":
      message += `📝 A été _inscrit${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "désignation":
      message += `📝 A été _désigné${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "détachement":
      message += `📝 A été _détaché${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "radiation":
      message += `📝 A été _radié${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "renouvellement":
      message += `📝 A été _renouvelé${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "reconduction":
      message += `📝 A été _reconduit${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "élection":
      message += `📝 A été _élu${elem.sexe == "F" ? "e" : ""}_ à:\n`;
      break;
    case "admissibilite":
      message += `📝 A été _admissible_ à:\n`;
      break;

    default:
      message += `📝 A été _${elem.type_ordre}_ à:\n`;
  }
  return message;
}

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

function addPublishDate(elem: { source_date: string }, message: string) {
  if (elem.source_date) {
    message += `🗓 _Publié le_:  ${convertToFrenchDate(elem.source_date)} \n`;
  }
  return message;
}

export function formatSearchResult(
  result: string | any[],
  options: {
    isConfirmation: any;
    isListing?: any;
    displayName?: any;
    hidePublicationDate?: any;
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
    message = addTypeOrdre(elem, message);
    message = addPoste(elem, message);
    if (!options?.hidePublicationDate) message = addPublishDate(elem, message);
    message = addLinkJO(elem, message);
    message += "\n";
  }
  return message;
}

export function convertToFrenchDate(date: string) {
  const dateToConvert = new Date(date);
  return dateToConvert.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
