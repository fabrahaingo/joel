const { sendLongText } = require("../utils/handleLongText")
const start = require("./start")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        await bot.sendChatAction(chatId, "typing")
        const what = `JOEL est un robot Telegram gratuit qui permet de suivre les nominations de vos contacts au [Journal Officiel](https://www.journal-officiel.gouv.fr/pages/accueil/) 👀\n \n`
        const when = `Il a vu le jour en 2022 👶.\n`
        const who = `Des questions ? 🤔 Vous pouvez contacter ses créateurs [Fabien](https://www.linkedin.com/in/fabien-rahaingomanana/) et [Philémon](https://www.linkedin.com/in/philemon-perrot/).\n \n`
        const how = `Le robot s'appuie principalement sur l'outil [JORFSearch](https://www.steinertriples.ch/ncohen/data/nominations_JORF/) créé par [Nathann](https://www.steinertriples.ch/ncohen/).`
        const text = what + when + who + how
        sendLongText(bot, chatId, text)
            .then(async () => {
                // wait 5 seconds
                await new Promise(resolve => setTimeout(resolve, 5000))
                await start(bot)(msg)
            })
    } catch (error) {
        console.log(error)
    }
}