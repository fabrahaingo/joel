const startKeyboard = {
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

module.exports = { startKeyboard };
