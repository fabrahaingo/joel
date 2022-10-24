require("dotenv").config()
const mongoose = require("mongoose")
const env = process.env
const config = require("../config")
const People = require('../models/People')
const User = require('../models/User')
const axios = require("axios")
const { formatSearchResult } = require("../utils/formatSearchResult")
const { handleLongText } = require("../utils/handleLongText")


// TODO: optimize this and only retrieve people updated after X time ago
async function getPeople() {
    const people = await People.find({}, { _id: 1, JORFSearchData: 1, updatedAt: 1 })
    return people
}

async function getUsers() {
    const users = await User.find({}, { _id: 1, chatId: 1, followedPeople: 1 })
    return users
}

async function sendUpdate(user, usersUpdated) {
    if (!user.chatId) {
        console.log(`Can't send notifications to ${user._id}. Must run /start again to update his chatId.`)
        return
    }

    let notification_text = "📢 Aujourd'hui, il y a eu de nouvelles publications pour les personnes que vous suivez !\n\n"
    for (let user of usersUpdated) {
        notification_text += `Nouvelle publication pour *${user.JORFSearchData[0].prenom} ${user.JORFSearchData[0].nom}*\n`
        notification_text += formatSearchResult([user.JORFSearchData[0]], { isListing: true })
        if (usersUpdated.indexOf(user) + 1 !== usersUpdated.length)
            notification_text += "\n"
    }

    const messagesArray = handleLongText(notification_text)

    for await (let message of messagesArray) {
        await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
            chat_id: user.chatId,
            text: message,
            parse_mode: "markdown"
        })
    }

    console.log(`Sent notification to ${user._id}`)
}

// check if user is following someone and if he is, check if he is up to date
// this function returns an array of people who are not up to date for a specific user
async function checkOutdatedUsers(user, people) {
    let usersUpdated = []

    for await (let personFollowed of user.followedPeople) {
        let personInDB = await people.find(person =>
            person._id.toString() === personFollowed.peopleId.toString()
        )
        // user followed is not in db anymore
        // in that case, we remove it from followedPeople list
        if (!personInDB) {
            const indexToRemove = user.followedPeople.indexOf(personFollowed)
            user.followedPeople.splice(indexToRemove, 1)
        } else {
            // personFollowed is outdated
            if (new Date(personFollowed.lastUpdate) < new Date(personInDB.updatedAt)) {
                usersUpdated.push(personInDB)
                personFollowed.lastUpdate = personInDB.updatedAt
            }
        }
    }
    if (usersUpdated.length) {
        await sendUpdate(user, usersUpdated)
    }
    await user.save()
}

async function notifyUsers(users, people) {
    for await (let user of users) {
        await checkOutdatedUsers(user, people)

        // prevent hitting Telegram API rate limit
        await new Promise(resolve => setTimeout(resolve, 500))
    }
}

mongoose
    .connect(env.MONGODB_URI, config.mongodb)
    .then(async () => {
        const users = await getUsers()
        const people = await getPeople()
        await notifyUsers(users, people)
        process.exit(0)
    })
    .catch(err => {
        console.log(err)
    })