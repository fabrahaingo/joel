const mongoose = require("mongoose")
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
        JORFSearchData: {
            type: Array
        }
    },
    { timestamps: true }
)

// Return the people if exists else create a new people
PeopleSchema.statics.firstOrCreate = async function (tgPeople) {
    let people = await this.findOne({ nom: tgPeople.nom, prenom: tgPeople.prenom })
    if (!people & tgPeople.nom && tgPeople.prenom && tgPeople.JORFSearchData) {
        people = await new this({
            nom: tgPeople.nom,
            prenom: tgPeople.prenom,
            JORFSearchData: tgPeople.JORFSearchData
        }).save()
    }

    return people
}

module.exports = mongoose.model("People", PeopleSchema)