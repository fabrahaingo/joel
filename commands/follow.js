const { startKeyboard, yesNoKeyboard } = require("../utils/keyboards")
const { formatSearchResult } = require("../utils/formatSearchResult")
const People = require("../models/People")
const User = require("../models/User")
const axios = require("axios")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        await bot.sendChatAction(chatId, "typing")
        const question = await bot.sendMessage(chatId, "Entrez le nom et prénom de la personne que vous souhaitez suivre:", {
            reply_markup: {
                force_reply: true
            },
        })
        await bot.onReplyToMessage(chatId, question.message_id, async msg => {
            let JORFRes = await axios.get(encodeURI(`https://jorfsearch.steinertriples.ch/name/${msg.text}?format=JSON`))
                .then(async res => {
                    if (res.data?.length === 0) {
                        return res
                    }
                    if (res.request.res.responseUrl) {
                        return await axios.get(res.request.res.responseUrl.endsWith('?format=JSON') ? res.request.res.responseUrl : `${res.request.res.responseUrl}?format=JSON`)
                    }
                })

            if (JORFRes?.data?.length === 0) {
                await bot.sendMessage(chatId, "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement", startKeyboard)
            } else {
                let formattedData = formatSearchResult(JORFRes.data.slice(0, 3), { isConfirmation: true })
                const people = await People.firstOrCreate({
                    nom: JORFRes.data[0].nom,
                    prenom: JORFRes.data[0].prenom,
                    JORFSearchData: JORFRes.data,
                })
                await people.save()
                const confirmation = await bot.sendMessage(chatId, formattedData, yesNoKeyboard)
                await bot.onReplyToMessage(chatId, confirmation.message_id, async msg => {
                    // if user confirms that he wants to follow this person
                    if (new RegExp(/oui/i).test(msg.text)) {
                        const tgUser = msg.from
                        let user = await User.firstOrCreate(tgUser, chatId)
                        // only add to followedPeople if user is not already following this person
                        if (!user.followedPeople.includes(people.id)) {
                            user.followedPeople.push({ peopleId: people.id, lastUdpate: Date.now() })
                            await user.save()
                        }
                        await bot.sendMessage(chatId, `Vous suivez maintenant *${JORFRes.data[0].prenom} ${JORFRes.data[0].nom}* ✅`, startKeyboard)
                    } else {
                        await bot.sendMessage(chatId, "Suivi abandonné 🙅‍♂️", startKeyboard)
                    }
                })
            }
        })
    } catch (error) {
        console.log(error)
    }
}