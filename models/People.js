const mongoose = require('mongoose')
const Schema = mongoose.Schema

const PeopleSchema = new Schema(
	{
		nom: {
			type: String,
			required: true,
		},
		prenom: {
			type: String,
			required: true,
		},
		lastKnownPosition: {
			type: Object,
			required: true,
		},
	},
	{ timestamps: true }
)

// Return the people if exists else create a new people
PeopleSchema.statics.firstOrCreate = async function (tgPeople) {
	let people = await this.findOne({
		nom: tgPeople.nom,
		prenom: tgPeople.prenom,
	})
	if (people && !people.lastKnownPosition) {
		people.lastKnownPosition = tgPeople.lastKnownPosition
		people = await people.save()
	} else if (!people) {
		people = await new this({
			nom: tgPeople.nom,
			prenom: tgPeople.prenom,
			lastKnownPosition: tgPeople.lastKnownPosition,
		}).save()
	}

	return people
}

module.exports = mongoose.model('People', PeopleSchema)
