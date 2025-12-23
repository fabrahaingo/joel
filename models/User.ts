import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami.ts";
import {
  IOrganisation,
  ISession,
  IPeople,
  IUser,
  UserModel,
  WikidataId,
  JORFReference,
  NotificationType,
  MessageApp
} from "../types.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { loadUser } from "../entities/Session.ts";
import { cleanPeopleName } from "../utils/JORFSearch.utils.ts";
import { getISOWeek } from "../utils/date.utils.ts";
import { logError } from "../utils/debugLogger.ts";

export const USER_SCHEMA_VERSION = 3;

const UserSchema = new Schema<IUser, UserModel>(
  {
    chatId: {
      type: String,
      required: true
    },
    messageApp: {
      type: String,
      required: true
    },
    roomId: {
      type: String,
      required: false,
      default: undefined
    },
    language_code: {
      type: String,
      required: true,
      default: "fr"
    },
    status: {
      type: String,
      enum: ["active", "blocked"],
      default: "active",
      required: true
    },
    waitingReengagement: { type: Boolean, default: false, required: false },
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
      default: [],
      required: true
    },
    followedFunctions: {
      type: [
        {
          functionTag: {
            type: String
          },
          lastUpdate: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: [],
      required: false
    },
    followedNames: {
      type: [String],
      default: [],
      required: false
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
      default: [],
      required: false
    },
    followedMeta: {
      type: [
        {
          alertString: {
            type: String
          },
          lastUpdate: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: [],
      required: false
    },
    costHistory: {
      type: [{ operationDate: Date, operationType: String, cost: Number }],
      default: [],
      required: false
    },
    pendingNotifications: {
      type: [
        {
          notificationType: {
            type: String
          },
          source_ids: { type: [String] },
          insertDate: {
            type: Date
          },
          items_nb: {
            type: Number
          }
        }
      ],
      default: [],
      required: false
    },
    transferData: {
      type: {
        code: {
          type: String
        },
        expiresAt: {
          type: Date
        }
      },
      required: false,
      default: undefined
    },
    schemaVersion: {
      type: Number,
      required: true
    },
    lastInteractionDay: {
      type: Date,
      required: false,
      default: undefined
    },
    lastInteractionWeek: {
      type: Date,
      required: false,
      default: undefined
    },
    lastInteractionMonth: {
      type: Date,
      required: false,
      default: undefined
    },
    lastMessageReceivedAt: {
      type: Date,
      required: false,
      default: undefined
    }
  },
  {
    timestamps: true
  }
);

UserSchema.static(
  "findOrCreate",
  async function (session: ISession): Promise<IUser> {
    try {
      if (session.user != null) return session.user;

      const user: IUser | null = await loadUser(session);
      if (user != null) return user;

      umami.log({ event: "/new-user", messageApp: session.messageApp });
      const newUser = await this.create({
        chatId: session.chatId,
        messageApp: session.messageApp,
        roomId: session.roomId,
        language_code: session.language_code,
        schemaVersion: USER_SCHEMA_VERSION
      });

      await newUser.updateInteractionMetrics();
      return newUser;
    } catch (error) {
      await logError(session.messageApp, "Error findOrCreate user", error);
    }
    throw new Error("Error findOrCreate user");
  }
);

UserSchema.method(
  "updateInteractionMetrics",
  async function updateInteractionMetrics(this: IUser): Promise<void> {
    let needSaving = false;

    if (this.status === "blocked") {
      umami.log({
        event: "/user-unblocked-joel",
        messageApp: this.messageApp,
        hasAccount: true
      });
      this.status = "active";
      needSaving = true;
    }

    const now = new Date();
    const currentDay = new Date(now);
    currentDay.setHours(4, 0, 0, 0);

    // For daily active users - check if the last interaction was before today
    if (
      this.lastInteractionDay === undefined ||
      this.lastInteractionDay.toDateString() !== currentDay.toDateString()
    ) {
      this.lastInteractionDay = currentDay;
      umami.log({
        event: "/daily-active-user",
        messageApp: this.messageApp,
        hasAccount: true
      });
      needSaving = true;
    }

    // For weekly active users - check if the last interaction was in a different ISO week
    const thisWeek = getISOWeek(now);
    const lastInteractionWeek = this.lastInteractionWeek
      ? getISOWeek(this.lastInteractionWeek)
      : undefined;
    if (
      this.lastInteractionWeek === undefined ||
      thisWeek !== lastInteractionWeek
    ) {
      this.lastInteractionWeek = currentDay;
      umami.log({
        event: "/weekly-active-user",
        messageApp: this.messageApp,
        hasAccount: true
      });
      needSaving = true;
    }

    // For monthly active users - check if last interaction was in a different month
    if (
      this.lastInteractionMonth === undefined ||
      this.lastInteractionMonth.getMonth() !== now.getMonth() ||
      this.lastInteractionMonth.getFullYear() !== now.getFullYear()
    ) {
      const startMonth = new Date(currentDay);
      startMonth.setDate(1);
      this.lastInteractionMonth = startMonth;
      umami.log({
        event: "/monthly-active-user",
        messageApp: this.messageApp,
        hasAccount: true
      });
      needSaving = true;
    }

    if (needSaving) await this.save();
  }
);

UserSchema.method(
  "checkFollowedPeople",
  function checkFollowedPeople(
    this: IUser,
    people: IPeople | Types.ObjectId
  ): boolean {
    const peopleId = people instanceof Types.ObjectId ? people : people._id;
    return this.followedPeople.some(
      (person) => person.peopleId.toString() === peopleId.toString()
    );
  }
);

UserSchema.method(
  "addFollowedPeople",
  async function addFollowedPeople(this: IUser, peopleToFollow: IPeople) {
    if (this.checkFollowedPeople(peopleToFollow._id)) return false;
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
      if (this.checkFollowedPeople(people._id)) continue;
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
  async function removeFollowedPeople(
    this: IUser,
    peopleToUnfollow: IPeople | Types.ObjectId
  ) {
    const peopleId =
      peopleToUnfollow instanceof Types.ObjectId
        ? peopleToUnfollow
        : peopleToUnfollow._id;
    if (!this.checkFollowedPeople(peopleId)) return false;
    this.followedPeople = this.followedPeople.filter((elem) => {
      return elem.peopleId.toString() !== peopleId.toString();
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "checkFollowedFunction",
  function checkFollowedFunction(this: IUser, fct: FunctionTags): boolean {
    return this.followedFunctions.some((elem) => {
      return elem.functionTag === fct;
    });
  }
);

UserSchema.method(
  "addFollowedFunction",
  async function addFollowedFunction(this: IUser, fct: FunctionTags) {
    if (this.checkFollowedFunction(fct)) return false;
    this.followedFunctions.push({ functionTag: fct, lastUpdate: new Date() });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedFunction",
  async function removeFollowedFunction(this: IUser, fct: FunctionTags) {
    if (!this.checkFollowedFunction(fct)) return false;
    this.followedFunctions = this.followedFunctions.filter((elem) => {
      return elem.functionTag !== fct;
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "checkFollowedName",
  function checkFollowedName(this: IUser, name: string): boolean {
    const nameClean = cleanPeopleName(name);
    return this.followedNames.some((elem) => {
      return elem.toUpperCase() === nameClean.toUpperCase();
    });
  }
);

UserSchema.method(
  "checkFollowedAlertString",
  function checkFollowedAlertString(this: IUser, alertString: string): boolean {
    const normalizedAlertString = alertString.trim().toLowerCase();
    return this.followedMeta.some((elem) => {
      return elem.alertString.trim().toLowerCase() === normalizedAlertString;
    });
  }
);

UserSchema.method(
  "addFollowedAlertString",
  async function addFollowedAlertString(this: IUser, alertString: string) {
    if (this.checkFollowedAlertString(alertString)) return false;
    this.followedMeta.push({
      alertString: alertString.trim(),
      lastUpdate: new Date()
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedAlertString",
  async function removeFollowedAlertString(this: IUser, alertString: string) {
    if (!this.checkFollowedAlertString(alertString)) return false;
    const normalizedAlertString = alertString.trim().toLowerCase();
    this.followedMeta = this.followedMeta.filter((elem) => {
      return elem.alertString.trim().toLowerCase() !== normalizedAlertString;
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "checkFollowedOrganisation",
  function checkFollowedOrganisation(
    this: IUser,
    organisation: IOrganisation | WikidataId
  ): boolean {
    const wikidataId =
      typeof organisation === "string" ? organisation : organisation.wikidataId;
    return this.followedOrganisations.some(
      (elem) => elem.wikidataId === wikidataId
    );
  }
);

UserSchema.method(
  "addFollowedOrganisation",
  async function addFollowedOrganisation(
    this: IUser,
    organisation: IOrganisation | WikidataId
  ) {
    const wikidataId =
      typeof organisation === "string" ? organisation : organisation.wikidataId;
    if (this.checkFollowedOrganisation(wikidataId)) return false;
    this.followedOrganisations.push({
      wikidataId,
      lastUpdate: new Date()
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "removeFollowedOrganisation",
  async function removeFollowedOrganisation(
    this: IUser,
    organisation: IOrganisation | WikidataId
  ) {
    const wikidataId =
      typeof organisation === "string" ? organisation : organisation.wikidataId;
    if (!this.checkFollowedOrganisation(wikidataId)) return false;
    this.followedOrganisations = this.followedOrganisations.filter(
      (elem) => elem.wikidataId !== wikidataId
    );
    await this.save();
    return true;
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
    this.followedNames = this.followedNames.filter((elem) => {
      return elem.toUpperCase() !== name.toUpperCase();
    });
    await this.save();
    return true;
  }
);

UserSchema.method(
  "followsNothing",
  function followsNothing(this: IUser): boolean {
    return (
      this.followedPeople.length +
        this.followedNames.length +
        this.followedFunctions.length +
        this.followedOrganisations.length +
        this.followedMeta.length ===
      0
    );
  }
);

UserSchema.static(
  "insertPendingNotifications",
  async function insertPendingNotifications(
    userId: Types.ObjectId,
    messageApp: MessageApp,
    notificationType: NotificationType,
    notificationSources: Map<JORFReference, number>
  ): Promise<void> {
    const source_ids: JORFReference[] = [];
    let items_nb = 0;

    const user: IUser | null = await this.findOne(
      { _id: userId },
      { pendingNotifications: 1 }
    ).lean();
    if (user === null) {
      await logError(
        messageApp,
        `insertPendingNotifications couldn't find user with id ${userId.toString()}`
      );
      return;
    }

    for (const source of notificationSources.keys()) {
      if (
        user.pendingNotifications.some((elem) =>
          elem.source_ids.includes(source)
        )
      )
        continue;

      source_ids.push(source);
      const elem_nb = notificationSources.get(source);
      if (elem_nb != null) items_nb += elem_nb;
    }
    if (source_ids.length === 0) return;

    const newNotification: IUser["pendingNotifications"][number] = {
      notificationType,
      source_ids,
      insertDate: new Date(),
      items_nb
    };

    await this.updateOne(
      { _id: userId },
      {
        $push: {
          pendingNotifications: newNotification
        }
      }
    );
  }
);

UserSchema.index({ "followedPeople.peopleId": 1 });
UserSchema.index({ "followedFunctions.functionTag": 1 });
UserSchema.index({ "followedOrganisations.wikidataId": 1 });

UserSchema.index({ "transferData.code": 1 });

UserSchema.index({ messageApp: 1, chatId: 1 }, { unique: true });

export default model<IUser, UserModel>("User", UserSchema);
