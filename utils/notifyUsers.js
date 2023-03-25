require('dotenv').config()
const mongoose = require('mongoose')
const env = process.env
const config = require('../config')
const People = require('../models/People')
const User = require('../models/User')
const axios = require('axios')
const PDFDocument = require('pdfkit')
const fs = require('fs')
const FormData = require('form-data')

// only retrieve people who have been updated on same day
async function getPeople() {
	// get date in format YYYY-MM-DD
	const currentDate = new Date().toISOString().split('T')[0]
	// const currentDate = '2023-05-19'
	const people = await People.find(
		{
			updatedAt: {
				$gte: new Date(currentDate),
			},
		},
		{ _id: 1, lastKnownPosition: 1, updatedAt: 1 }
	)
	return people
}

// the argument is a list of _id of people who have been updated
// retrieve all users who follow at least one of these people
async function getUsers(updatedPeople) {
	const peopleIdStringArray = returnIdsArray(updatedPeople).map((id) =>
		id.toString()
	)
	const currentDate = new Date().toISOString().split('T')[0]
	// const currentDate = '2023-05-19'
	// also retrieve user for which followedFunctions array is not empty
	// retieve full list of followedPeople for each user
	const users = await User.find(
		{
			$or: [
				{
					followedPeople: {
						$elemMatch: {
							peopleId: {
								$in: peopleIdStringArray,
							},
						},
					},
				},
				{
					followedFunctions: {
						$ne: [],
					},
				},
			],
		},
		{ _id: 1, followedPeople: 1, followedFunctions: 1, chatId: 1 }
	)

	for (let user of users) {
		let followed = []
		for (let followedPerson of user.followedPeople) {
			const idUpdated = peopleIdStringArray.includes(
				followedPerson.peopleId.toString()
			)
			const lastUpdate = new Date(followedPerson.lastUpdate)
				.toISOString()
				.split('T')[0]
			if (idUpdated && lastUpdate !== currentDate) {
				followed.push(followedPerson)
			}
		}
		user.followedPeople = followed
	}
	return users
}

function addTypeOrdre(elem) {
	const female = elem.sexe == 'F'
	switch (elem.type_ordre) {
		case 'nomination':
			return `A été nommé${female ? 'e' : ''} à:`
		case 'réintégration':
			return `A été réintégré${female ? 'e' : ''} à:`
		case 'cessation de fonction':
			return `A cessé ses fonctions à:`
		case 'affectation':
			return `A été affecté${female ? 'e' : ''} à:`
		case 'délégation de signature':
			return `A reçu une délégation de signature à:`
		case 'promotion':
			return `A été promu${female ? 'e' : ''}:`
		case 'admission':
			return `A été admis${female ? 'e' : ''} à:`
		case 'inscription':
			return `A été inscrit${female ? 'e' : ''} à:`
		case 'désignation':
			return `A été désigné${female ? 'e' : ''} à:`
		case 'détachement':
			return `A été détaché${female ? 'e' : ''} à:`
		case 'radiation':
			return `A été radié${female ? 'e' : ''} à:`
		case 'renouvellement':
			return `A été renouvelé${female ? 'e' : ''} à:`
		case 'reconduction':
			return `A été reconduit${female ? 'e' : ''} à:`
		case 'élection':
			return `A été élu${female ? 'e' : ''} à:`
		case 'admissibilite':
			return `A été admissible à:\n`
		default:
			return `A été ${elem.type_ordre} à:`
	}
}

function addPoste(elem) {
	let message = ''
	if (elem.organisations && elem.organisations[0]?.nom) {
		return elem.organisations[0].nom
	} else if (elem.ministre) {
		return elem.ministre
	} else if (elem.inspecteur_general) {
		return `Inspecteur général des ${elem.inspecteur_general}`
	} else if (elem.grade) {
		message += `au grade de ${elem.grade}`
		if (elem.ordre_merite) {
			message += ` de l'Ordre national du mérite`
		} else if (elem.legion_honneur) {
			message += ` de la Légion d'honneur`
		}
		return (message += `${elem.nomme_par ? ` par le ${elem.nomme_par}` : ''}`)
	} else if (elem.autorite_delegation) {
		return `par le ${elem.autorite_delegation}`
	}
	return message
}

function addLinkJO(elem) {
	if (elem.source_id) {
		switch (elem.source_name) {
			case 'BOMI':
				return `https://bodata.steinertriples.ch/${elem.source_id}.pdf`
			default:
				return `https://www.legifrance.gouv.fr/jorf/id/${elem.source_id}`
		}
	}
	return 'https://www.legifrance.gouv.fr/'
}

function addHeader(doc, dateInfo) {
	doc
		.image('./img/logo_lowres.png', 15, 15, { width: 40 })
		.fontSize(15)
		.font('Helvetica-Bold')
		.text(
			`Nominations du ${dateInfo.day} ${dateInfo.number} ${dateInfo.month} ${dateInfo.year}`,
			65,
			29,
			{ oblique: true }
		)
		.moveDown()
		.text('', doc.x - 45, doc.y)
		.fontSize(12)
		.font('Helvetica')
}

async function fillFunctions(doc, peopleFromFunctions) {
	for (let functionId in peopleFromFunctions) {
		doc
			.moveDown(1.5)
			.font('Helvetica')
			.fontSize(13)
			.text('Vous suivez la fonction ', { continued: true })
			.font('Helvetica-Bold')
			.fontSize(13)
			.text(functionId, { underline: true })
			.moveDown()

		for (let person of peopleFromFunctions[functionId]) {
			let info = person.lastKnownPosition
			doc
				.image('./img/emojis/detective.png', doc.x, doc.y + 1, {
					width: 10,
				})
				.fontSize(12)
				.font('Helvetica-Bold')
				.text(`${info.nom} ${info.prenom}`, doc.x, doc.y + 1, { indent: 15 })
				.moveDown(0.1)

			doc
				.image('./img/emojis/write.png', doc.x, doc.y + 1, { width: 10 })
				.fontSize(12)
				.font('Helvetica')
				.text(addTypeOrdre(info), doc.x, doc.y + 1, {
					oblique: true,
					indent: 15,
				})
				.moveDown(0.1)

			doc
				.image('./img/emojis/right.png', doc.x, doc.y + 1, { width: 10 })
				.fontSize(12)
				.font('Helvetica-Bold')
				.text(addPoste(info), doc.x, doc.y + 1, { indent: 15 })
				.moveDown(0.1)

			doc
				.image('./img/emojis/link.png', doc.x, doc.y + 1, { width: 10 })
				.fontSize(12)
				.font('Helvetica')
				.text('Lien JO: ', doc.x, doc.y + 1, {
					oblique: true,
					indent: 15,
					continued: true,
				})
				.fontSize(12)
				.font('Helvetica')
				.text('cliquez ici', doc.x, doc.y + 1, {
					underline: true,
					link: addLinkJO(info),
				})
				.moveDown()
		}
	}
}

function fillPeople(doc, peopleUpdated) {
	doc
		.moveDown(1.5)
		.fontSize(13)
		.font('Helvetica')
		.text("Voici vos contacts qui sont apparus au Journal officiel aujourd'hui")
		.moveDown()

	for (let person of peopleUpdated) {
		let info = person.lastKnownPosition
		doc
			.image('./img/emojis/detective.png', doc.x, doc.y + 1, { width: 10 })
			.font('Helvetica-Bold')
			.fontSize(12)
			.text(`${info.nom} ${info.prenom}`, doc.x, doc.y + 1, { indent: 15 })
			.moveDown(0.1)

		doc
			.image('./img/emojis/write.png', doc.x, doc.y + 1, { width: 10 })
			.font('Helvetica')
			.text(addTypeOrdre(info), doc.x, doc.y + 1, { oblique: true, indent: 15 })
			.moveDown(0.1)

		doc
			.image('./img/emojis/right.png', doc.x, doc.y + 1, { width: 10 })
			.font('Helvetica-Bold')
			.text(addPoste(info), doc.x, doc.y + 1, { indent: 15 })
			.moveDown(0.1)

		doc
			.image('./img/emojis/link.png', doc.x, doc.y + 1, { width: 10 })
			.fontSize(12)
			.font('Helvetica')
			.text('Lien JO: ', doc.x, doc.y + 1, {
				oblique: true,
				indent: 15,
				continued: true,
			})
			.fontSize(12)
			.font('Helvetica')
			.text('cliquez ici', {
				underline: true,
				link: addLinkJO(info),
			})
			.moveDown(1.5)
	}
}

async function createPDF(path, dateInfo, peopleFromFunctions, peopleUpdated) {
	return new Promise(async (resolve) => {
		// To determine when the PDF has finished being written successfully
		// we need to confirm the following 2 conditions:
		//
		//   1. The write stream has been closed
		//   2. PDFDocument.end() was called syncronously without an error being thrown
		let pendingStepCount = 2
		const stepFinished = () => {
			if (--pendingStepCount == 0) {
				resolve()
			}
		}
		const doc = new PDFDocument({ margin: 10, lineGap: 3, paragraphGap: 3 })
		const writeStream = fs.createWriteStream(path)
		writeStream.on('close', stepFinished)
		doc.pipe(writeStream)
		addHeader(doc, dateInfo)
		doc.on('pageAdded', () => {
			addHeader(doc, dateInfo)
		})
		if (peopleUpdated.length > 0) {
			fillPeople(doc, peopleUpdated)
		}
		if (Object.keys(peopleFromFunctions).length > 0) {
			fillFunctions(doc, peopleFromFunctions)
		}
		doc.end()
		stepFinished()
	})
}

function deleteFile(path) {
	fs.unlink(path, (err) => {
		if (err) {
			console.log(err)
		}
	})
}

async function createPDFandSend(user, peopleFromFunctions, peopleUpdated) {
	const dateInfo = {
		day: new Date().toLocaleString('fr-FR', { weekday: 'long' }),
		month: new Date().toLocaleString('fr-FR', { month: 'long' }),
		year: new Date().getFullYear(),
		number: new Date().getDate(),
	}

	const path = `./notifications/notifications-${user._id}.pdf`
	const filename = `JOEL-${dateInfo.day}-${dateInfo.number}-${dateInfo.month}-${dateInfo.year}.pdf`
	await createPDF(path, dateInfo, peopleFromFunctions, peopleUpdated)
	const formData = new FormData()
	formData.append('chat_id', user.chatId)
	formData.append(
		'caption',
		'📢 Aujourd’hui, il y a eu de nouvelles publications au JO susceptibles de vous intéresser !'
	)
	formData.append('thumbnail', fs.createReadStream('./img/logo_lowres.png'))
	let pdf = fs.createReadStream(path)

	formData.append('document', pdf, {
		filename,
		contentType: 'application/pdf',
	})

	await axios
		.post(
			`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendDocument`,
			formData,
			{
				headers: {
					'Content-Type': 'multipart/form-data',
				},
			}
		)
		.then(() => {
			deleteFile(path)
		})
		.catch((err) => {
			deleteFile(path)
			console.log(err.message)
			console.log(err)
		})
}

async function sendUpdate(user, peopleUpdated) {
	if (!user.chatId) {
		console.log(
			`Can't send notifications to ${user._id}. Must run /start again to update his chatId.`
		)
		return
	}
	// use mongoose to retrive all people that the user follows using a tag
	// tags are stored in the user.followedFunctions array
	// we know a person belongs to a tag if the tag is a key in the person lastKnownPosition object which equals to the string "true"
	const tagsList = user.followedFunctions
	let peopleFromFunctions = {}
	if (tagsList) {
		for (let tag of tagsList) {
			// get all people that have a lastKnownPosition object with a key that equals to the tag
			// and that have been updated today
			let listOfPeopleFromTag = await People.find(
				{
					[`lastKnownPosition.${tag}`]: {
						$exists: true,
					},
					updatedAt: {
						$gte: new Date(new Date().toISOString().split('T')[0]),
					},
				},
				{ _id: 1, lastKnownPosition: 1, updatedAt: 1 }
			)
			if (listOfPeopleFromTag.length > 0) {
				peopleFromFunctions[tag] = listOfPeopleFromTag
			}
		}
	}

	if (Object.keys(peopleFromFunctions).length > 0 || peopleUpdated.length > 0) {
		await createPDFandSend(user, peopleFromFunctions, peopleUpdated)
		console.log(`Sent notification to ${user._id}`)
	}
}

async function populatePeople(user, peoples) {
	const peopleUpdated = []
	for await (let followedPerson of user.followedPeople) {
		const person = peoples.find(
			(person) => person._id.toString() === followedPerson.peopleId.toString()
		)
		if (person) {
			peopleUpdated.push(person)
		}
	}
	return peopleUpdated
}

async function updateUser(user, peoples) {
	// get array of ids from peoples
	const peoplesIdArray = returnIdsArray(peoples).map((id) => id.toString())
	// get user from db
	const userFromDb = await User.findById(user._id)
	// update followedPeople
	for (let followedPerson of userFromDb.followedPeople) {
		if (peoplesIdArray.includes(followedPerson.peopleId.toString())) {
			followedPerson.lastUpdate = new Date()
		}
	}
	// remove duplicated in followedPeople array that have same peopleId (can happen if user has followed a person twice)
	userFromDb.followedPeople = userFromDb.followedPeople.filter(
		(followedPerson, index, self) =>
			index ===
			self.findIndex(
				(t) => t.peopleId.toString() === followedPerson.peopleId.toString()
			)
	)
	// save user
	await userFromDb.save()
}

async function notifyUsers(users, peoples) {
	for await (let user of users) {
		// create an array of people who have been updated
		let peopleUpdated = await populatePeople(user, peoples)
		if (peopleUpdated.length || user.followedFunctions.length) {
			// remove duplicates from peopleUpdated array
			peopleUpdated = peopleUpdated.filter(
				(person, index, self) =>
					index ===
					self.findIndex((t) => t._id.toString() === person._id.toString())
			)
			// update field updatedAt in followedPeople
			await updateUser(user, peoples)
			// send notification to user
			await sendUpdate(user, peopleUpdated)
		}
		// prevent hitting Telegram API rate limit
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
}

function returnIdsArray(arr) {
	let res = []
	for (let item of arr) {
		res.push(item._id)
	}
	return res
}

mongoose.set('strictQuery', false)
mongoose
	.connect(env.MONGODB_URI, config.mongodb)
	.then(async () => {
		// 1. get all people who have been updated today
		const peoples = await getPeople()
		const peopleIds = returnIdsArray(peoples)
		// 2. get all users who follow at least one of these people
		const users = await getUsers(peopleIds)
		// 3. send notification to users
		await notifyUsers(users, peoples)
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
	})
