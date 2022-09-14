const User = require("../models/User")
const People = require("../models/People")
const { formatSearchResult } = require("../utils/formatSearchResult")
const { sendLongText } = require("../utils/handleLongText")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        await bot.sendChatAction(chatId, "typing")

        let text = ''
        let user = await User.findOne({ _id: msg.from.id })

        if (!user || user.length === 0) {
            text = "Une erreur s'est produite avec votre profil. Merci d'envoyer /start pour réessayer."
        } else {
            // get array of ids of people
            let peopleIds = user.followedPeople.map(p => p.peopleId)
            let peoples = await People.find({ _id: { $in: peopleIds } })
            text += "Voici les personnes que vous suivez :\n\n"
            for (let i = 0; i < peoples.length; i++) {
                text += `${i + 1}. *${peoples[i].prenom} ${peoples[i].nom}*\n\n`
                text += formatSearchResult([peoples[i].JORFSearchData[0]], { isListing: true })
                if (peoples[i + 1]) {
                    text += `\n`
                }
            }
        }

        await sendLongText(bot, chatId, text)
    } catch (error) {
        console.log(error)
    }
}