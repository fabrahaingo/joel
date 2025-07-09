import { TypeOrdre } from "../types.js";

export const textTypeOrdre = (
  type_ordre: TypeOrdre,
  sex: "F" | "M"
): string => {
  const agree = (genre: "F" | "M"): string => {
    return genre === "F" ? "e" : "";
  };

  switch (type_ordre) {
    case "nomination":
      return `📝 A été _nommé${agree(sex)}_ à:\n`;
    case "réintégration":
      return `📝 A été _réintégré${agree(sex)}_ à:\n`;
    case "cessation de fonction":
      return `📝 A _cessé ses fonctions_ à:\n`;
    case "affectation":
      return `📝 A été _affecté${agree(sex)}_ à:\n`;
    case "délégation de signature":
      return `📝 A reçu une _délégation de signature_ à:\n`;
    case "promotion":
      return `📝 A été _promu${agree(sex)}_:\n`;
    case "admission":
      return `📝 A été _admis${agree(sex)}_ \n`;
    case "inscription":
      return `📝 A été _inscrit${agree(sex)}_ à:\n`;
    case "désignation":
      return `📝 A été _désigné${agree(sex)}_ à:\n`;
    case "détachement":
      return `📝 A été _détaché${agree(sex)}_ à:\n`;
    case "radiation":
      return `📝 A été _radié${agree(sex)}_ à:\n`;
    case "renouvellement":
      return `📝 A été _renouvelé${agree(sex)}_ à:\n`;
    case "reconduction":
      return `📝 A été _reconduit${agree(sex)}_ dans ses fonctions\n`;
    case "élection":
      return `📝 A été _élu${agree(sex)}_ à:\n`;
    case "admissibilité":
      return `📝 A été _admissible_ à:\n`;
    case "charge":
      return `📝 A été _chargé${agree(sex)}_ de:\n`;
    case "intégration":
      return `📝 A été _intégré${agree(sex)}_ à:\n`;
    //case "composition"
    case "habilitation":
      return `📝 A été _habilité${agree(sex)}_ à:\n`;
    case "titularisation":
      return `📝 A été _titularisé${agree(sex)}_ à:\n`;
    case "recrutement":
      return `📝 A été _recruté${agree(sex)}_:\n`;
    case "disponibilité":
      return `📝 A été mis${agree(sex)} en disponibilité_\n`;
    case "autorisation":
      return `📝 A été _autorisé${agree(sex)}_\n`;
    case "mise à disposition":
      return `📝 A été _mis${agree(sex)} à disposition_\n`;
    case "décharge":
      return `📝 A été _déchargé${agree(sex)}_\n`;
    case "diplome":
      return `📝 A été _diplômé${agree(sex)}_ de:\n`;
    case "mutation":
      return `📝 A été _muté${agree(sex)}_:\n`;
    case "décoration":
      return `📝 A été _décoré${agree(sex)}_:\n`;
    case "élévation":
      return `📝 A été _élevé${agree(sex)}_:\n`;
    case "transfert":
      return `📝 A été _transféré${agree(sex)}_:\n`;
    case "conféré":
      return `📝 S'est vu${agree(sex)} _conférer_:\n`;
    case "citation":
      return `📝 A été _cité${agree(sex)}_:\n`;
    case "démission":
      return `📝 A _démissionné_:\n`;
    case "attribution":
      return `📝 S'est vu _attribué${agree(sex)}_:\n`;
    case "reprise de fonctions":
      return `📝 A _repris ses fonctions_:\n`;
    //| "bourse"
    //| "fin délégation signature"
    //| "prime"
    default:
      return `📝 A été _${type_ordre}_ à:\n`;
  }
};
