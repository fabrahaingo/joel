const { startKeyboard } = require("../utils/keyboards")
const User = require("../models/User")
const People = require("../models/People")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        bot.sendChatAction(chatId, "typing")

        let text = ''
        let user = await User.findOne({ _id: msg.from.id })
        if (!user || user.length === 0) {
            text = "Une erreur s'est produite avec votre profil. Merci d'envoyer /start pour réessayer."
        } else {
            // get array of ids of people
            let peopleIds = user.followedPeople.map(p => p.peopleId)
            let peoples = await People.find({ _id: { $in: peopleIds } })
            text += "Indiquez le numéro du contact que nous souhaitez arrêter de suivre :\n\n"
            for (let i = 0; i < peoples.length; i++) {
                text += `${i + 1}. *${peoples[i].prenom} ${peoples[i].nom}*\n\n`
            }
        }

        const question = await bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: { force_reply: true } })

        await bot.onReplyToMessage(chatId, question.message_id, async msg => {
            const userAnswer = parseInt(msg.text)
            if (isNaN(userAnswer)) {
                // TODO: handle that case
                bot.sendMessage(chatId, "Merci d'entrer un numéro de contact", startKeyboard)
                return
            }
            let peopleId = user.followedPeople[userAnswer - 1]?.peopleId
            let people = await People.findOne({ _id: peopleId })
            if (!people) {
                bot.sendMessage(chatId, "Contact introuvable, assurez vous d'avoir tapé un numéro existant", startKeyboard)
            } else {
                user.followedPeople.splice(userAnswer - 1, 1)
                await user.save()
                bot.sendMessage(chatId, `Vous ne suivez plus *${people.prenom} ${people.nom}* ❌`, startKeyboard)
            }
        })
    } catch (error) {
        console.log(error)
    }
}