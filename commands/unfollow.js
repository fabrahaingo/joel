const { startKeyboard } = require('../utils/keyboards')
const { sendLongText } = require('../utils/handleLongText')
const User = require('../models/User')
const People = require('../models/People')

module.exports = (bot) => async (msg) => {
	const chatId = msg.chat.id
	try {
		bot.sendChatAction(chatId, 'typing')
		let text = ''
		let user = await User.findOne({ _id: msg.from.id })
		let peopleIds = user.followedPeople.map((p) => p.peopleId)
		let peoples = await People.find({ _id: { $in: peopleIds } })
			.collation({ locale: 'fr' })
			.sort({ nom: 1 })
		if (!user || user.length === 0) {
			text =
				"Une erreur s'est produite avec votre profil. Merci d'envoyer /start pour réessayer."
		} else {
			if (peoples.length === 0) {
				return bot.sendMessage(
					chatId,
					`Vous ne suivez aucun contact pour le moment. Tapez /start puis cliquez sur *🏃 Ajouter un contact* pour commencer à suivre des contacts.`,
					startKeyboard
				)
			} else {
				text +=
					'Indiquez le numéro du contact que nous souhaitez arrêter de suivre :\n\n'
				for (let i = 0; i < peoples.length; i++) {
					text += `${i + 1}. *${peoples[i].nom} ${peoples[i].prenom}*\n\n`
				}
			}
		}

		const question_id = await sendLongText(bot, chatId, text, {
			returnLastMessageId: true,
		})

		return await bot.onReplyToMessage(chatId, question_id, async (msg) => {
			const userAnswer = parseInt(msg.text)
			if (isNaN(userAnswer)) {
				// TODO: handle that case
				bot.sendMessage(
					chatId,
					"La réponse donnée n'est pas sous forme de nombre. Veuillez taper /start puis réessayer.",
					startKeyboard
				)
				return
			}
			// id to remove
			const idToRemove = peoples[userAnswer - 1]._id
			const nom = peoples[userAnswer - 1].nom
			const prenom = peoples[userAnswer - 1].prenom
			// remove from followedPeople
			user.followedPeople = user.followedPeople.filter(
				(p) => !p.peopleId.equals(idToRemove)
			)
			await user.save()
			bot.sendMessage(
				chatId,
				`Vous ne suivez plus *${nom} ${prenom}* 🙅‍♂️`,
				startKeyboard
			)
		})
	} catch (error) {
		console.log(error)
	}
}
