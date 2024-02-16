import { Keyboard } from "../types";

export const startKeyboard: Keyboard = {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
  reply_markup: JSON.stringify({
    resize_keyboard: true,
    keyboard: [
      [{ text: "🧩 Ajouter un contact" }, { text: "👨‍💼 Ajouter une fonction" }],
      [{ text: "✋ Retirer un suivi" }, { text: "🧐 Lister mes suivis" }],
      [{ text: "🔎 Rechercher" }, { text: "❓ Aide / Contact" }],
    ],
  }),
};

export const numberKeyboard: Keyboard = {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
  reply_markup: JSON.stringify({
    resize_keyboard: true,
    keyboard: [
      [{ text: "1" }, { text: "2" }, { text: "3" }],
      [{ text: "4" }, { text: "5" }, { text: "6" }],
      [{ text: "7" }, { text: "8" }, { text: "9" }],
      [{ text: "0" }, { text: "🔙 Retour" }],
    ],
  }),
};
