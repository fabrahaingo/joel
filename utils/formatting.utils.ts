import { TypeOrdre } from "../types";

export const textTypeOrdre = (
  type_ordre: TypeOrdre,
  sex?: "F" | "M"
): string => {
  const agree = (genre?: "F" | "M"): string => {
    switch (genre) {
      case "M":
        return "";
      case "F":
        return "e";
      default:
        return ".e"; // point médian
    }
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
    default:
      return `📝 A été _${type_ordre}_ à:\n`;
  }
};
