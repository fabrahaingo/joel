const mongoose = require("mongoose")
const Schema = mongoose.Schema

const UserSchema = new Schema(
    {
        _id: {
            type: Number,
            required: true,
        },
        first_name: {
            type: String,
            required: true,
        },
        last_name: {
            type: String,
            required: true,
        },
        username: String,
        // to send notifications later on
        chatId: Number,
        language_code: String,
        status: {
            type: String,
            enum: ["active", "blocked"],
            default: "active",
        },
        followedPeople: [{
            peopleId: {
                type: mongoose.Types.ObjectId
            },
            lastUpdate: {
                type: Date,
                default: Date.now
            }
        }]
    },
    { timestamps: true, _id: false }
)

// Return the user if exists else create a new user
UserSchema.statics.firstOrCreate = async function (tgUser, chatId) {
    let user = await this.findById(tgUser.id)
    if (!user && !tgUser.is_bot) {
        user = await new this({
            _id: tgUser.id,
            chatId: chatId,
            first_name: tgUser.first_name,
            last_name: tgUser.last_name,
            username: tgUser.username,
            language_code: tgUser.language_code,
        }).save()
    }

    return user
}

module.exports = mongoose.model("User", UserSchema)