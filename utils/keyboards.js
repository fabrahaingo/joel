const startKeyboard = {
    parse_mode: "Markdown",
    reply_markup: JSON.stringify({
        resize_keyboard: true,
        keyboard: [
            [{ text: "🏃 Ajouter un contact" }, { text: "🔎 Rechercher" }],
            [{ text: "✋ Supprimer un contact" }, { text: "🧐 Lister mes contacts" }],
        ],
    })
}

const yesNoKeyboard = {
    parse_mode: "Markdown",
    reply_markup: JSON.stringify({
        // resize_keyboard: true,
        // keyboard: [
        //     [{ text: "Oui" }, { text: "Non" }],
        // ],
        force_reply: true
    })
}

module.exports = { startKeyboard, yesNoKeyboard }