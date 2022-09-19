const startKeyboard = {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: JSON.stringify({
        resize_keyboard: true,
        keyboard: [
            [{ text: "🏃 Ajouter un contact" }, { text: "🔎 Rechercher" }],
            [{ text: "✋ Supprimer un contact" }, { text: "🧐 Lister mes contacts" }],
            [{ text: "🐞 Un bug ?" }, { text: "❓ Aide" }],
        ],
    })
}

const yesNoKeyboard = {
    parse_mode: "Markdown",
    reply_markup: JSON.stringify({
        resize_keyboard: true,
        // keyboard: [
        //     [{ text: "Oui" }, { text: "Non" }],
        // ],
        // one_time_keyboard: true,
        force_reply: true
    })
}

module.exports = { startKeyboard, yesNoKeyboard }