import { TypeOrdre } from "../types";
import { dateToFrenchString } from "./date.utils";

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
      return `📝 A été _reconduit${agree(sex)}_ à:\n`;
    case "élection":
      return `📝 A été _élu${agree(sex)}_ à:\n`;
    case "admissibilite":
      return `📝 A été _admissible_ à:\n`;
    default:
      return `📝 A été _${type_ordre}_ à:\n`;
  }
};

export const textPublishDate = (date: string): string => {
  if (date) {
    return `🗓 _Publié le_:  ${dateToFrenchString(date)} \n`;
  }
  return "";
};
