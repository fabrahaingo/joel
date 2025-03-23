import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import User from "../models/User";
import People from "../models/People";
import { IPeople, IUser, UserModel }  from "../types";
import TelegramBot from "node-telegram-bot-api";
import {FunctionTags} from "../entities/FunctionTags";

// Put all user instance methods in this interface:
interface IUserMethods {
    checkFollowPeople(person: IPeople): boolean;
    checkFollowFunction(functionTag: FunctionTags): boolean;
    addFollowedPeople(person: IPeople): Promise<boolean>;
    addFollowedFunction(functionTag: FunctionTags): Promise<boolean>;
    removeFollowedPeople(person: IPeople): Promise<boolean>;
    removeFollowedFunction(functionTag: FunctionTags): Promise<boolean>;
}

const UserSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
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

UserSchema.method('checkFollowFunction', function removeFollowedFunction(functionTag: FunctionTags): boolean {
    return this.followedFunctions.some(elem => functionTag===elem);
});

UserSchema.method('addFollowedFunction', async function addFollowedFunction(functionTag: FunctionTags): Promise<boolean> {
    if (this.checkFollowFunction(functionTag)) return false; // If tag followed

    // If tag is not followed: we add it
    this.followedFunctions.push(functionTag);
    await this.save()
    return true;
});

UserSchema.method('removeFollowedFunction', async function removeFollowedFunction(functionTag: FunctionTags): Promise<boolean> {
    if (!this.checkFollowFunction(functionTag)) return false; // If tag not followed

    // If tag is followed: we remove it
    this.followedFunctions= this.followedFunctions
        .filter(elem => {
            return elem !== functionTag;
        });
    await this.save()
    return true;
});

UserSchema.method('checkFollowPeople', function removeFollowedPeople(person: IPeople): boolean {
    return this.followedPeople.some((elem) =>
        elem.peopleId.toString() === person._id.toString()
    );
});

UserSchema.method('addFollowedPeople', async function addFollowedPerson(person: IPeople): Promise<boolean> {
    if (this.checkFollowPeople(person)) return false; // If person followed

    // If person is not followed: we add it
    this.followedPeople.push({ peopleId: person._id, lastUpdate: new Date});
    await this.save()
    return true;
});

UserSchema.method('removeFollowedPeople', async function removeFollowedPeople(person: IPeople): Promise<boolean> {
    if (!this.checkFollowPeople(person)) return false; // If person not followed

    // If person is followed: we remove it
    this.followedPeople=this.followedPeople
        .filter(elem => {
            return !elem.peopleId.equals(person._id)
            });
    await this.save()

    // We count the number of people in the db still following this person
    const remainingFollowerNb= await User.countDocuments(
        {
            followedPeople: {
                $elemMatch: {
                    peopleId: person._id
                },
            },
        });

    // If the person is not followed by anyone anymore, we remove it from the db
    if (remainingFollowerNb == 0){
        await People.deleteOne({ _id: person._id });
        await umami.log({ event: "/person-deleted"})
    }
    return true;
});

UserSchema.static(
  "firstOrCreate",
  async function (args: {
    tgUser: TelegramBot.User | undefined;
    chatId: number;
  }) {
    if (!args.tgUser) throw new Error("No user provided");

    const user = await this.findOne({ _id: args.tgUser.id });

    if (!user && !args.tgUser.is_bot && !isNaN(args.chatId)) {
      await umami.log({ event: "/new-user" });
      const newUser = new this({
        _id: args.tgUser.id,
        chatId: args.chatId,
        language_code: args.tgUser.language_code,
      });
      await newUser.save();

      return newUser;
    }

    return user;
  }
);

export default model<IUser, UserModel>("User", UserSchema);
