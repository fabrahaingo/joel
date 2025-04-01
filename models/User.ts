import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { IUser, UserModel } from "../types";
import TelegramBot from "node-telegram-bot-api";
import {FunctionTags} from "../entities/FunctionTags";

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


export default model<IUser, UserModel>("User", UserSchema);
