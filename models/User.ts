import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami.js";
import { ISession, IPeople, IUser, UserModel } from "../types.js";
import { FunctionTags } from "../entities/FunctionTags.js";

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
    messageApp: {
      type: String,
      default: "Telegram",
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
    lastInteractionDay: {
      type: Date,
    },
    lastInteractionWeek: {
      type: Date,
    },
    lastInteractionMonth: {
      type: Date,
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
    followedOrganisations: {
      type: [
          {
              wikidataId: {
                  type: String,
              },
              lastUpdate: {
                  type: Date,
                  default: Date.now,
              },
          },
      ],
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
  "findOrCreate",
  async function (session: ISession): Promise<IUser> {
    if (session.user != null) return session.user;

    const user: IUser | null = await this.findOne({
        messageApp: session.messageApp,
        chatId : session.chatId
    });

    if (user === null) {
      await umami.log({ event: "/new-user" });
      const newUser = new this({
          messageApp: session.messageApp,
          chatId : session.chatId,
          language_code: session.language_code,
      });
      await newUser.save();

      return newUser;
    }

    return user;
  }
);

UserSchema.method('updateInteractionMetrics', async function updateInteractionMetrics() {
    let needSaving=false;

    const currentDay = new Date();
    currentDay.setHours(4, 0, 0, 0);
    if (this.lastInteractionDay === undefined || this.lastInteractionDay.getTime() < currentDay.getTime()) {
        this.lastInteractionDay = currentDay;
        await umami.log({event: "/daily-active-user"});
        needSaving=true;
    }

    const startWeek = new Date(currentDay);
    startWeek.setDate(startWeek.getDate() - startWeek.getDay()+1);
    if (this.lastInteractionWeek === undefined || this.lastInteractionWeek.getTime() < startWeek.getTime()) {
        this.lastInteractionWeek = startWeek;
        await umami.log({event: "/weekly-active-user"});
        needSaving=true;
    }

    const startMonth = new Date(currentDay);
    startMonth.setDate(1);
    if (this.lastInteractionMonth === undefined || this.lastInteractionMonth.getTime() < startMonth.getTime()) {
        this.lastInteractionMonth = startMonth;
        await umami.log({event: "/monthly-active-user"});
        needSaving=true;
    }

    if (needSaving) await this.save();
});


UserSchema.method('checkFollowedPeople', function checkFollowedPeople(people: IPeople): boolean {
    return this.followedPeople.some((person) => person.peopleId === people._id);
});

UserSchema.method('addFollowedPeople', async function addFollowedPeople(peopleToFollow: IPeople) {
    if (this.checkFollowedPeople(peopleToFollow)) return false;
    this.followedPeople.push({
        peopleId: peopleToFollow._id as Types.ObjectId,
        lastUpdate: new Date(),
    });
    await this.save();
    return true;
});

UserSchema.method('addFollowedPeopleBulk', async function addFollowedPeopleBulk(peopleToFollow: IPeople[]) {
    for (const people of peopleToFollow) {
        if (this.checkFollowedPeople(people)) continue;
        this.followedPeople.push({
            peopleId: people._id as Types.ObjectId,
            lastUpdate: new Date(),
        });
    }
    await this.save();
    return true;
});

UserSchema.method('removeFollowedPeople', async function removeFollowedPeople(peopleToUnfollow: IPeople) {
    if (!this.checkFollowedPeople(peopleToUnfollow)) return false;
    this.followedPeople = this.followedPeople.filter((elem) => {
        return !((elem.peopleId as Types.ObjectId).toString === (peopleToUnfollow._id as Types.ObjectId).toString);
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
