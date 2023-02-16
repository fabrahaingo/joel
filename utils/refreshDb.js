require('dotenv').config()
const People = require('../models/People')
const mongoose = require('mongoose')
const config = require('../config')
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

// function that makes sure that the JORF data is up to date
mongoose
	.connect(process.env.MONGODB_URI, config.mongodb)
	.then(async () => {
		let total = 0
		const people = await People.find({})
		for await (let person of people) {
			const jorfData = await getJORFInfo(person.prenom, person.nom)
			if (jorfData) {
				person.lastKnownPosition = jorfData.data[0]
				await person.save()
				total++
				console.log(`${person.nom} ${person.prenom} was updated`)
			}
			if (total % 50 === 0) {
				console.log(termColors.green, `${total} people were updated`)
			}
		}
		console.log(termColors.green, `${total} people were updated`)
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
	})
