require('dotenv').config()
const mongoose = require('mongoose')
const env = process.env
const config = require('../config')
const People = require('../models/People')
const axios = require('axios')

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

async function getUpdatedUsers() {
	// get todays date in DD-MM-YYYY format (separator is a dash)
	// const today = new Date().toLocaleDateString('fr-FR').split('/').join('-')
	const today = '27-10-2022'
	return await axios
		.get(`https://jorfsearch.steinertriples.ch/${today}?format=JSON`)
		.then((res) => res.data)
}

async function getAllPeople() {
	return await People.find({}, { _id: 1, prenom: 1, nom: 1 })
}

async function updatePeople(updatedUsers, allPeople) {
	let countUpdated = 0
	for await (let user of updatedUsers) {
		for await (let person of allPeople) {
			const foundCondition =
				person.prenom === user.prenom && person.nom === user.nom
			if (foundCondition) {
				const jorfInfo = await getJORFInfo(person.prenom, person.nom)
				// if person was (still) not found in JORF
				if (typeof jorfInfo.data !== 'object') {
					console.log(
						`${person.nom} ${person.prenom} is stored in db but was not found on JORFSearch`
					)
					continue
				}
				person.JORFSearchData = jorfInfo.data
				await person.save()
				console.log(`${person.nom} ${person.prenom} was updated`)
				countUpdated++
			}
		}
	}
	console.log(termColors.green, `${countUpdated} people were updated`)
	return
}

async function getJORFInfo(firstName, lastName) {
	return await axios
		.get(
			`https://jorfsearch.steinertriples.ch/name/${encodeURI(
				`${firstName} ${lastName}`
			)}?format=JSON`
		)
		.then(async (res) => {
			if (typeof res.data !== 'object') {
				const redirectedTo = res.request.res.responseUrl
				// if the person was not found or not well formatted, the API redirects
				res = await axios.get(
					redirectedTo.endsWith('?format=JSON')
						? redirectedTo
						: `${redirectedTo}?format=JSON`
				)
			}
			return res
		})
		.catch((err) => {
			console.log(`Unable to fetch JORF data for ${firstName} ${lastName}`)
			console.log(err.message)
		})
}

mongoose
	.connect(env.MONGODB_URI, config.mongodb)
	.then(async () => {
		const updatedUsers = await getUpdatedUsers()
		const allPeople = await getAllPeople()
		await updatePeople(updatedUsers, allPeople)
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
		process.exit(1)
	})
