import { Types } from "mongoose";
import UserSchema from "../models/User";

import mongoose from 'mongoose';
import {mongodbConnect} from "../db";

// Define the old schema to read existing data
const oldUserSchema = new mongoose.Schema({
        _id: {
            type: Number,
            required: true,
        },
        chatId: {
            type: Number,
            required: true,
        },
        language_code: {
            type: String,
            required: true,
            default: "fr",
        },
        status: {
            type: String,
            enum: ["active", "blocked"],
            default: "active",
        },
        followedPeople: {
            type: [
                {
                    peopleId: {
                        type: Types.ObjectId,
                    },
                    lastUpdate: {
                        type: Date,
                        default: Date.now,
                    },
                },
            ],
            default: [],
        },
        followedFunctions: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
        _id: false,
    }
);
// Create models for old and new schemas

// Define the new old and new schemas
const OldUser = mongoose.model('User', oldUserSchema);
const NewUser = UserSchema;

// Load, convert and save data
async function migrateFollowedFunctions() {
    try {
        await mongodbConnect();

        // Read users with the old schema
        const users = await OldUser.find();

        for (const user of users) {
            // Transform the data to match the new schema
            const updatedFollowedFunctions = user.followedFunctions.map(functionTag => ({
                functionTag,
                lastUpdate: Date.now(),
            }));

            // Create a new user document with the new schema
            const newUser = new NewUser({ ...user , followedFunctions: updatedFollowedFunctions});

            // Save the updated user document
            await newUser.save();
        }

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await mongoose.disconnect();
    }
}

(async () => {
    await migrateFollowedFunctions();
})();

