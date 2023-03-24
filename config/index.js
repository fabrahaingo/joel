module.exports = {
	bot: {
		polling: true,
		onlyFirstMatch: true,
		filepath: false,
	},
	script: {
		polling: false,
	},
	mongodb: {
		useNewUrlParser: true,
		useUnifiedTopology: true,
	},
	message: {
		textLimit: 300,
	},
}
