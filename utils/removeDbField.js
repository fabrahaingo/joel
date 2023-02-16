require('dotenv').config()
const People = require('../models/People')
const mongoose = require('mongoose')
const config = require('../config')

// function that makes sure that the JORF data is up to date
mongoose
	.connect(process.env.MONGODB_URI, config.mongodb)
	.then(async () => {
		await People.updateMany({}, { $unset: ['JORFSearchData'] })
		console.log(`Fields were removed`)
		process.exit(0)
	})
	.catch((err) => {
		console.log(err)
	})
