import TelegramBot from "node-telegram-bot-api";

export const menuKeyboardPattern = [
    [{ text: "🔎 Rechercher" }, { text: "👨‍💼 Ajouter une fonction" }],
    [{ text: "✋ Retirer un suivi" }, { text: "🧐 Lister mes suivis" }],
    [{ text: "❓ Aide / Contact" }]
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

export function customKeyboard(keyboard: { text: string }[][]): TelegramBot.SendMessageOptions {
    return {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
            selective: true,
            resize_keyboard: true,
            keyboard: keyboard,
        },
    }
}