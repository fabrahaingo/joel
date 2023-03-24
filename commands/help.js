const { sendLongText } = require('../utils/handleLongText')

module.exports = (bot) => async (msg) => {
	const chatId = msg.chat.id
	try {
		await bot.sendChatAction(chatId, 'typing')
		const what = `JOEL est un robot Telegram sans but lucratif qui permet de suivre les nominations de vos contacts au [Journal Officiel](https://www.journal-officiel.gouv.fr/pages/accueil/) 👀\n`
		const when = `Il a vu le jour en 2022 👶.\n`
		const how = `Le robot s'appuie principalement sur l'outil [JORFSearch](https://www.steinertriples.ch/ncohen/data/nominations_JORF/) créé par [Nathann](https://www.steinertriples.ch/ncohen/).\n\n`
		const who = `Des questions ? Un bug ? 🤔\nVous pouvez contacter ses créateurs [Fabien](https://www.linkedin.com/in/fabien-rahaingomanana/) ([@hellofabien](https://t.me/hellofabien)) et [Philémon](https://www.linkedin.com/in/philemon-perrot/) en mentionnant votre id Telegram: *${chatId}*.\n\n`
		const updates = `Pour rester au courant des nouveautés, des corrections de bugs ainsi que des améliorations de JOEL, rejoignez notre channel officiel [@joel_news](https://t.me/joel_news).`
		const text = what + when + how + who + updates
		await sendLongText(bot, chatId, text, { maxLength: 800 })
	} catch (error) {
		console.log(error)
	}
}
