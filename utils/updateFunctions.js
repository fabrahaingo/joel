require('dotenv').config()
const mongoose = require('mongoose')
const env = process.env
const config = require('../config')
const People = require('../models/People')
const axios = require('axios')
const functions = require('../json/functionTags.json')

const termColors = {
	black: '\x1b[30m%s\x1b[30m',
	red: '\x1b[31m%s\x1b[31m',
	green: '\x1b[32m%s\x1b[32m',
	yellow: '\x1b[33m%s\x1b[33m',
	blue: '\x1b[34m%s\x1b[34m',
	magenta: '\x1b[35m%s\x1b[35m',
	cyan: '\x1b[36m%s\x1b[36m',
	white: '\x1b[37m%s\x1b[37m',
}

async function getPeopleToAddOrUpdate() {
	const today = new Date().toLocaleDateString('fr-FR').split('/').join('-')
	// const today = '22-03-2023'
	let dailyUpdates = await axios
		.get(`https://jorfsearch.steinertriples.ch/${today}?format=JSON`)
		.then((res) => res.data)
	// remove duplicate people (the ones who have the same nom and prenom)
	return dailyUpdates.filter(
		(contact, index, self) =>
			index ===
			self.findIndex(
				(t) => t.nom === contact.nom && t.prenom === contact.prenom
			)
	)
}

// extracts the relevant tags from the daily updates
// format: {tag: [contacts], tag2: [contacts]}
async function extractRelevantTags(dailyUpdates) {
	let newObj = {}
	let tags = Object.values(functions)
	for (let contact of dailyUpdates) {
		for (let tag of tags) {
			if (contact.hasOwnProperty(tag)) {
				if (newObj[tag]) {
					newObj[tag].push(contact)
				} else {
					newObj[tag] = [contact]
				}
			}
		}
	}
	return newObj
}

async function updageTags(tagsToUpdate) {
	let total = 0
	for await (let tag of Object.keys(tagsToUpdate)) {
		for await (let contact of tagsToUpdate[tag]) {
			// check if the person already exists in the db
			let person = await People.findOne({
				nom: contact.nom,
				prenom: contact.prenom,
			})
			// if the person exists, update the lastKnownPosition
			if (person) {
				person.lastKnownPosition = contact
				await person.save()
				console.log(`${person.nom} ${person.prenom} was updated`)
				total++
			}
			// if the person doesnt exist, create a new one
			else {
				const newPerson = new People({
					nom: contact.nom,
					prenom: contact.prenom,
					lastKnownPosition: contact,
				})
				await newPerson.save()
				console.log(`${newPerson.nom} ${newPerson.prenom} was added`)
				total++
			}
		}
	}
	console.log(termColors.green, `${total} people were updated`)
	return
}

mongoose.set('strictQuery', false)
mongoose
	.connect(env.MONGODB_URI, config.mongodb)
	.then(async () => {
		const dailyUpdates = await getPeopleToAddOrUpdate()
		const tagsToUpdate = await extractRelevantTags(dailyUpdates)
		await updageTags(tagsToUpdate)
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
		process.exit(1)
	})
