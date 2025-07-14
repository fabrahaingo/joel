import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami.ts";
import { ISession, IPeople, IUser, UserModel } from "../types.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { loadUser } from "../entities/Session.ts";

export const USER_SCHEMA_VERSION = 2;

const UserSchema = new Schema<IUser, UserModel>(
  {
    chatId: {
      type: Number,
      required: true
    },
    messageApp: {
      type: String,
      required: true
    },
    language_code: {
      type: String,
      required: true,
      default: "fr"
    },
    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active"
    },
    followedPeople: {
      type: [
        {
          peopleId: {
            type: Types.ObjectId
          },
          lastUpdate: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    },
    followedFunctions: {
      type: [String],
      default: []
    },
    followedNames: {
      type: [String],
      default: []
    },
    followedOrganisations: {
      type: [
        {
          wikidataId: {
            type: String
          },
          lastUpdate: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    },
    schemaVersion: {
      type: Number,
      required: true
    },

    lastInteractionDay: {
      type: Date
    },
    lastInteractionWeek: {
      type: Date
    },
    lastInteractionMonth: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

UserSchema.static(
  "findOrCreate",
  async function (session: ISession): Promise<IUser> {
    if (session.user != null) return session.user;

    const user: IUser | null = await loadUser(session);

    if (user != null) return user;

    await umami.log({ event: "/new-user" });
    return await this.create({
      chatId: session.chatId,
      messageApp: session.messageApp,
      language_code: session.language_code,
      schemaVersion: USER_SCHEMA_VERSION
    });
  }
);

UserSchema.method(
  "updateInteractionMetrics",
  async function updateInteractionMetrics(this: IUser) {
    let needSaving = false;

    const currentDay = new Date();
    currentDay.setHours(4, 0, 0, 0);
    if (
      this.lastInteractionDay === undefined ||
      this.lastInteractionDay.getTime() < currentDay.getTime()
    ) {
      this.lastInteractionDay = currentDay;
      await umami.log({ event: "/daily-active-user" });
      needSaving = true;
    }

    const startWeek = new Date(currentDay);
    startWeek.setDate(startWeek.getDate() - startWeek.getDay() + 1);
    if (
      this.lastInteractionWeek === undefined ||
      this.lastInteractionWeek.getTime() < startWeek.getTime()
    ) {
      this.lastInteractionWeek = startWeek;
      await umami.log({ event: "/weekly-active-user" });
      needSaving = true;
    }

    const startMonth = new Date(currentDay);
    startMonth.setDate(1);
    if (
      this.lastInteractionMonth === undefined ||
      this.lastInteractionMonth.getTime() < startMonth.getTime()
    ) {
      this.lastInteractionMonth = startMonth;
      await umami.log({ event: "/monthly-active-user" });
      needSaving = true;
    }

    if (needSaving) await this.save();
  }
);

UserSchema.method(
  "checkFollowedPeople",
  function checkFollowedPeople(this: IUser, people: IPeople): boolean {
    return this.followedPeople.some((person) => person.peopleId === people._id);
  }
);

UserSchema.method(
  "addFollowedPeople",
  async function addFollowedPeople(this: IUser, peopleToFollow: IPeople) {
    if (this.checkFollowedPeople(peopleToFollow)) return false;
    this.followedPeople.push({
      peopleId: peopleToFollow._id,
      lastUpdate: new Date()
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "addFollowedPeopleBulk",
  async function addFollowedPeopleBulk(this: IUser, peopleToFollow: IPeople[]) {
    for (const people of peopleToFollow) {
      if (this.checkFollowedPeople(people)) continue;
      this.followedPeople.push({
        peopleId: people._id,
        lastUpdate: new Date()
      });
    }
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedPeople",
  async function removeFollowedPeople(this: IUser, peopleToUnfollow: IPeople) {
    if (!this.checkFollowedPeople(peopleToUnfollow)) return false;
    this.followedPeople = this.followedPeople.filter((elem) => {
      return !(elem.peopleId.toString === peopleToUnfollow._id.toString);
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "checkFollowedFunction",
  function checkFollowedFunction(this: IUser, fct: FunctionTags): boolean {
    return this.followedFunctions.some((elem) => {
      return elem === fct;
    });
  }
);

UserSchema.method(
  "addFollowedFunction",
  async function addFollowedFunction(this: IUser, fct: FunctionTags) {
    if (this.checkFollowedFunction(fct)) return false;
    this.followedFunctions.push(fct);
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedFunction",
  async function removeFollowedFunctions(this: IUser, fct: FunctionTags) {
    if (!this.checkFollowedFunction(fct)) return false;
    this.followedFunctions = this.followedFunctions.filter((elem) => {
      return elem !== fct;
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "checkFollowedName",
  function checkFollowedName(this: IUser, name: string): boolean {
    return this.followedNames.some((elem) => {
      return elem.toUpperCase() === name.toUpperCase();
    });
  }
);

UserSchema.method(
  "addFollowedName",
  async function addFollowedName(this: IUser, name: string) {
    if (this.checkFollowedName(name)) return false;
    this.followedNames.push(name);
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedName",
  async function removeFollowedName(this: IUser, name: string) {
    if (!this.checkFollowedName(name)) return false;
    this.followedFunctions = this.followedFunctions.filter((elem) => {
      return elem.toUpperCase() !== name.toUpperCase();
    });
    await this.save();
    return true;
  }
);

UserSchema.method("followsNothing", function followsNothing(): boolean {
  let nb_followed = this.followedPeople.length + this.followedFunctions.length;
  if (this.followedNames !== undefined)
    nb_followed += this.followedNames.length;
  //if (this.followedOrganisations !== undefined) nb_followed+=this.followedOrganisations.length;
  return nb_followed == 0;
});

export default model<IUser, UserModel>("User", UserSchema);
