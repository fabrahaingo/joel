import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { IUser, MessageApp, UserModel } from "../types";
import TelegramBot from "node-telegram-bot-api";

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
    message_app: {
      type: String,
      required: true,
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
      required: true,
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
      required: true,
    },
    followedNames: {
        type: [String],
        default: [],
        required: true,
    },
    followedFunctions: {
      type: [String],
      default: [],
      required: true,
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
    message_app: MessageApp;
  }): Promise<IUser | null> {
    if (args.tgUser.is_bot || isNaN(args.chatId)) return null;

    const user: IUser | null = await this.findOne({ _id: args.tgUser.id });

    if (user === null) {
      await umami.log({ event: "/new-user" });
      const newUser = new this({
        _id: args.tgUser.id,
        chatId: args.chatId,
        message_app: args.message_app,
        language_code: args.tgUser.language_code,
      });
      await newUser.save();

      return newUser;
    }

    return user;
  }
);

export default model<IUser, UserModel>("User", UserSchema);
