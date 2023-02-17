require('dotenv').config()
const mongoose = require('mongoose')
const env = process.env
const config = require('../config')
const People = require('../models/People')
const User = require('../models/User')
const axios = require('axios')
const { formatSearchResult } = require('../utils/formatSearchResult')
const { handleLongText } = require('../utils/handleLongText')

// only retrieve people who have been updated on same day
async function getPeople() {
	// get date in format YYYY-MM-DD
	const currentDate = new Date().toISOString().split('T')[0]
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
	const users = await User.find(
		{
			'followedPeople.peopleId': {
				$in: updatedPeople,
			},
		},
		{
			_id: 1,
			chatId: 1,
			followedPeople: 1,
		}
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

async function sendUpdate(user, peopleUpdated) {
	if (!user.chatId) {
		console.log(
			`Can't send notifications to ${user._id}. Must run /start again to update his chatId.`
		)
		return
	}

	let notification_text =
		"📢 Aujourd'hui, il y a eu de nouvelles publications pour les personnes que vous suivez !\n\n"
	for (let person of peopleUpdated) {
		notification_text += `Nouvelle publication pour *${person.lastKnownPosition.prenom} ${person.lastKnownPosition.nom}*\n`
		notification_text += formatSearchResult([person.lastKnownPosition], {
			isListing: true,
		})
		if (peopleUpdated.indexOf(person) + 1 !== peopleUpdated.length)
			notification_text += '\n'
	}

	const messagesArray = handleLongText(notification_text)

	for await (let message of messagesArray) {
		await axios.post(
			`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`,
			{
				chat_id: user.chatId,
				text: message,
				parse_mode: 'markdown',
			}
		)
	}

	console.log(`Sent notification to ${user._id}`)
}

async function populatePeople(user, peoples) {
	const peopleUpdated = []
	for await (let followedPerson of user.followedPeople) {
		const person = peoples.find(
			(person) => person._id.toString() === followedPerson.peopleId.toString()
		)
		// format YYYY-MM-DD
		const today = new Date().toISOString().split('T')[0]
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
		if (peopleUpdated.length) {
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
