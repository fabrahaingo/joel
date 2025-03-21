import TelegramBot from "node-telegram-bot-api";

export const menuKeyboardPattern = [
    [{ text: "🧩 Ajouter un contact" }, { text: "👨‍💼 Ajouter une fonction" }],
    [{ text: "✋ Retirer un suivi" }, { text: "🧐 Lister mes suivis" }],
    [{ text: "🔎 Rechercher" }, { text: "❓ Aide / Contact" }]
];

export const startKeyboard: TelegramBot.SendMessageOptions = {
  parse_mode: "Markdown",
  disable_web_page_preview: true,
  reply_markup: {
    selective: true,
    resize_keyboard: true,
    keyboard: menuKeyboardPattern,
  },
};
