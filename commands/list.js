const User = require('../models/User')
const People = require('../models/People')
// const { formatSearchResult } = require("../utils/formatSearchResult")
const { sendLongText } = require('../utils/handleLongText')

module.exports = (bot) => async (msg) => {
	const chatId = msg.chat.id
	try {
		await bot.sendChatAction(chatId, 'typing')

		let text = ''
		let user = await User.findOne({ _id: msg.from.id })

		if (!user || user.length === 0) {
			text =
				"Une erreur s'est produite avec votre profil. Merci d'envoyer /start pour réessayer."
		} else {
			// get array of ids of people
			let peopleIds = user.followedPeople.map((p) => p.peopleId)
			let peoples = await People.find({ _id: { $in: peopleIds } })
				.collation({ locale: 'fr' })
				.sort({ nom: 1 })

			if (peoples.length === 0) {
				text = `Vous ne suivez aucun contact pour le moment. Tapez /start puis cliquez sur *🏃 Ajouter un contact* pour commencer à suivre des contacts.`
			} else {
				text += 'Voici les personnes que vous suivez :\n\n'
				for (let i = 0; i < peoples.length; i++) {
					let nomPrenom = `${peoples[i].nom} ${peoples[i].prenom}`
					// JORFSearch needs a search query in this specific order
					let prenomNom = `${peoples[i].prenom} ${peoples[i].nom}`
					text += `${
						i + 1
					}. *${nomPrenom}* - [JORFSearch](https://jorfsearch.steinertriples.ch/name/${encodeURI(
						prenomNom
					)})\n`
					if (peoples[i + 1]) {
						text += `\n`
					}
				}
			}
		}

		await sendLongText(bot, chatId, text)
	} catch (error) {
		console.log(error)
	}
}
