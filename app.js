require("dotenv").config()
const TelegramBot = require("node-telegram-bot-api")
TelegramBot.Promise = require("bluebird").config({
    cancellation: true,
})
const mongoose = require("mongoose")
const env = process.env
const config = require("./config")
const commands = require("./commands")
// const handlers = require("./handlers")

const bot = new TelegramBot(env.BOT_TOKEN, config.bot)

mongoose
    .connect(env.MONGODB_URI, config.mongodb)
    .then(() => {
        // Commands
        bot.onText(/\/start$/, commands.start(bot))
        bot.onText(/🔎 Rechercher$/, commands.search(bot))
        bot.onText(/🏃 Ajouter un contact$/, commands.follow(bot))
        bot.onText(/✋ Supprimer un contact$/, commands.unfollow(bot))
        bot.onText(/🧐 Lister mes contacts$/, commands.list(bot))
        bot.onText(/🐞 Un bug ?$/, commands.bug(bot))
        // bot.onText(/❓ Aide$/, commands.help(bot))

        // Handlers
        // bot.on("callback_query", handlers.callbackQuery(bot))
        // bot.on("polling_error", handlers.botError)
        // bot.on("error", handlers.botError)

        // Successful connection
        console.log(`\u{1F41D} ${env.BOT_NAME} started successfully`)
    })
    .catch(error => console.error(error))