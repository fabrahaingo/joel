const { startKeyboard } = require('../utils/keyboards')

function handleLongText(longText, max = 3000) {
	let messagesArray = []
	let message = ''
	let nbOfCharsToLastNewLine = 0
	let stringToAddToNextMessage = ''
	let slices = longText.length / max
	for (let i = 0; i < slices; i++) {
		if (stringToAddToNextMessage.length > 0) {
			message =
				stringToAddToNextMessage + longText.slice(i * max, (i + 1) * max)
		} else {
			message = longText.slice(i * max, (i + 1) * max)
		}

		// dont do that if it's the last message
		if (i < slices - 1) {
			// to prevent markdown error, we must make sure the message is not split in the middle of a markdown element
			if (!message.lastIndexOf('\n\n'))
				nbOfCharsToLastNewLine = message.lastIndexOf('\n\n')
			else nbOfCharsToLastNewLine = message.lastIndexOf('\n')
			stringToAddToNextMessage = message.substring(nbOfCharsToLastNewLine)
			message = message.slice(0, nbOfCharsToLastNewLine)
		}

		messagesArray.push(message)
	}
	return messagesArray
}

function getInlineButtons(maxIndex, chatId, messageId, messagePart = 0) {
	let buttons = []
	if (messagePart === 0 && maxIndex) {
		buttons = [
			{
				text: ' ',
				callback_data: ' ',
			},
			{
				text: `${messagePart + 1}  /  ${maxIndex + 1}`,
				callback_data: ' ',
			},
			{
				text: '➡️',
				callback_data: `next ${chatId} ${messageId} ${messagePart + 1}`,
			},
		]
	} else if (messagePart === maxIndex && maxIndex !== 0) {
		buttons = [
			{
				text: '⬅️',
				callback_data: `previous ${chatId} ${messageId} ${
					messagePart ? messagePart - 1 : 0
				}`,
			},
			{
				text: `${messagePart + 1}  /  ${maxIndex + 1}`,
				callback_data: ' ',
			},
			{
				text: ' ',
				callback_data: ' ',
			},
		]
	} else if (messagePart && messagePart !== maxIndex) {
		buttons = [
			{
				text: '⬅️',
				callback_data: `previous ${chatId} ${messageId} ${
					messagePart ? messagePart - 1 : 0
				}`,
			},
			{
				text: `${messagePart + 1}  /  ${maxIndex + 1}`,
				callback_data: ' ',
			},
			{
				text: '➡️',
				callback_data: `next ${chatId} ${messageId} ${messagePart + 1}`,
			},
		]
	} else {
		buttons = []
	}
	return buttons
}

async function listenForCallback(bot, mArr, buttons) {
	// prevent multiple listeners
	await bot.off('callback_query')

	// listen for callback to change message part to display
	await bot.on('callback_query', async (msg) => {
		const cbData = msg.data.split(' ')
		const option = cbData[0]
		const cbChatId = Number(cbData[1])
		const cbMessageId = Number(cbData[2])
		const i = Number(cbData[3])
		if (option === 'next' && cbChatId && cbMessageId) {
			buttons = getInlineButtons(mArr.length - 1, cbChatId, cbMessageId, i)
			if (!mArr[i]) mArr[i] = '...'
			await bot
				.editMessageText(mArr[i], {
					chat_id: cbChatId,
					message_id: cbMessageId,
					parse_mode: 'Markdown',
					reply_markup: {
						inline_keyboard: [buttons],
					},
				})
				.catch((err) => {
					console.log('error', err.response?.body?.description)
				})
		} else if (option === 'previous' && cbChatId && cbMessageId) {
			buttons = getInlineButtons(mArr.length - 1, cbChatId, cbMessageId, i)
			if (!mArr[i]) mArr[i] = '...'
			await bot
				.editMessageText(mArr[i], {
					chat_id: cbChatId,
					message_id: cbMessageId,
					parse_mode: 'Markdown',
					reply_markup: {
						inline_keyboard: [buttons],
					},
				})
				.catch((err) => {
					console.log('error', err.response?.body?.description)
				})
		}
	})
	return
}

async function sendLongText(
	bot,
	chatId,
	formattedData,
	{
		expectsAnswer = false,
		keyboard = null,
		maxLength = 600,
		nextMessageId = 0,
	} = {}
) {
	const mArr = handleLongText(formattedData, maxLength)
	if (!nextMessageId) {
		let updates = await bot.getUpdates({ limit: 1 })
		nextMessageId = updates.length > 0 ? updates[0].message.message_id + 1 : 0
	}
	let buttons = getInlineButtons(mArr.length - 1, chatId, nextMessageId)

	if (mArr.length > 1) {
		// send fist part of message
		if (!mArr[0]) mArr[0] = '...'
		await bot.sendMessage(chatId, mArr[0], {
			parse_mode: 'Markdown',
			reply_markup: {
				inline_keyboard: [buttons],
			},
		})
		await listenForCallback(bot, chatId, buttons)

		// update the normal keyboard so that the user still has the options to select
		await bot.sendMessage(
			chatId,
			"Avez vous besoin d'autre chose ?",
			keyboard ?? startKeyboard
		)
	} else if (mArr.length === 1) {
		await bot.sendMessage(chatId, mArr[0], keyboard ?? startKeyboard)
	}
}

module.exports = { handleLongText, sendLongText }
