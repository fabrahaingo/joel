const axios = require("axios")
const { startKeyboard } = require("../utils/keyboards")
const { formatSearchResult } = require("../utils/formatSearchResult")
const { sendLongText } = require("../utils/handleLongText")

module.exports = bot => async msg => {
    const chatId = msg.chat.id
    try {
        bot.sendChatAction(chatId, "typing")
        const question = await bot.sendMessage(chatId, "De quelle personne souhaitez-vous voir l'historique des nominations ?", {
            reply_markup: {
                force_reply: true
            },
        })
        await bot.onReplyToMessage(chatId, question.message_id, async msg => {
            let JORFRes = await axios.get(`https://jorfsearch.steinertriples.ch/name/${encodeURI(msg.text)}?format=JSON`)
                .then(async res => {
                    if (res.data?.length === 0) {
                        return res
                    }
                    if (res.request.res.responseUrl) {
                        let result = await axios.get(res.request.res.responseUrl.endsWith('?format=JSON') ? res.request.res.responseUrl : `${res.request.res.responseUrl}?format=JSON`)
                        return result
                    }
                })
                .catch((err) => {
                    console.log(err)
                })

            if (JORFRes?.data?.length === 0) {
                bot.sendMessage(chatId, "Personne introuvable, assurez vous d'avoir bien tapé le nom et le prénom correctement", startKeyboard)
            } else {
                let formattedData = formatSearchResult(JORFRes.data)
                sendLongText(bot, chatId, formattedData)
            }
        })
    } catch (error) {
        console.log(error)
    }
}