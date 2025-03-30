import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { IPeople, IUser, UserModel } from "../types";
import TelegramBot from "node-telegram-bot-api";
import { FunctionTags } from "../entities/FunctionTags";

const UserSchema = new Schema<IUser, UserModel>(
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
    followedNames: {
        type: [String],
        default: [],
        required: true,
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

UserSchema.method('checkFollowedPeople', function checkFollowedPeople(people: IPeople): boolean {
    return this.followedPeople.some((person) => person.peopleId.equals(people._id));
});

UserSchema.method('addFollowedPeople', function addFollowedPeoples(peopleToFollow: IPeople) {
    if (this.checkFollowedPeople(peopleToFollow)) return false;
    this.followedPeople.push({
        peopleId: peopleToFollow._id,
        lastUpdate: new Date(),
    });
    this.save();
    return true;
});

UserSchema.method('addFollowedPeopleBulk', async function addFollowedPeoplesBulk(peopleToFollow: IPeople[]) {
    for (const people of peopleToFollow) {
        if (this.checkFollowedPeople(people)) continue;
        this.followedPeople.push({
            peopleId: people._id,
            lastUpdate: new Date(),
        });
    }
    this.save();
    return true;
});

UserSchema.method('removeFollowedPeople', async function removeFollowedPeoples(peopleToUnfollow: IPeople) {
    if (!this.checkFollowedPeople(peopleToUnfollow)) return false;
    this.followedPeople = this.followedPeople.filter((elem) => {
        return !elem.peopleId.equals(peopleToUnfollow._id);
    });
    await this.save();
    return true;
});


UserSchema.method('checkFollowedFunction', function checkFollowedFunction(fct: FunctionTags): boolean {
    return this.followedFunctions.some((elem) => {
        return elem === fct;
    });
});

UserSchema.method('addFollowedFunction', async function addFollowedFunction(fct: FunctionTags) {
    if (this.checkFollowedFunction(fct)) return false;
    this.followedFunctions.push(fct);
    await this.save();
    return true;
});

UserSchema.method('removeFollowedFunction', async function removeFollowedFunctions(fct: FunctionTags) {
    if (!this.checkFollowedFunction(fct)) return false;
    this.followedFunctions = this.followedFunctions.filter((elem) => {
        return elem !== fct;
    });
    await this.save();
    return true;
});

UserSchema.method('followsNothing', function followsNothing(): boolean {
    let nb_followed=this.followedPeople.length + this.followedFunctions.length;
    if (this.followedNames !== undefined) nb_followed+=this.followedNames.length;
    //if (this.followedOrganisations !== undefined) nb_followed+=this.followedOrganisations.length;
    return nb_followed == 0;
});

export default model<IUser, UserModel>("User", UserSchema);
