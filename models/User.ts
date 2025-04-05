import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { IUser, MessageApp, UserModel } from "../types";
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
    tgUser: TelegramBot.User;
    chatId: number;
    messageApp: MessageApp;
  }): Promise<IUser | null> {
    if (args.tgUser.is_bot || isNaN(args.chatId)) return null;

    const user: IUser | null = await this.findOne({ _id: args.tgUser.id });

    if (user === null) {
      await umami.log({ event: "/new-user" });
      const newUser = new this({
        _id: args.tgUser.id,
        chatId: args.chatId,
        messageApp: args.messageApp,
        language_code: args.tgUser.language_code,
      });
      await newUser.save();

      return newUser;
    }

    return user;
  }
);

UserSchema.method('saveDailyInteraction', async function saveDailyInteraction() {
    const currentDate = new Date();
    currentDate.setHours(0, 12, 0, 0);
    if (this.lastInteractionDay === undefined || this.lastInteractionDay.getTime() < currentDate.getTime()) {
        this.lastInteractionDay = currentDate;
        await this.save();
        await umami.log({event: "/daily-active-user"});
    }
});


export default model<IUser, UserModel>("User", UserSchema);
