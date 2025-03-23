import { Schema as _Schema, Types, model } from "mongoose";
const Schema = _Schema;
import umami from "../utils/umami";
import { ISession, IUser, UserModel} from "../types";

const UserSchema = new Schema<IUser, UserModel>(
  {
    message_app: {
      type: String,
      required: true,
      default: "Telegram",
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
);

UserSchema.static(
  "findOrCreate",
  async function (session: ISession): Promise<IUser> {
    const user: IUser | null = await this.findOne({
        message_app: session.message_app,
        chatId : session.chatId
    });

    if (user === null) {
      await umami.log({ event: "/new-user" });
      const newUser = new this({
          message_app: session.message_app,
          chatId : session.chatId,
          language_code: session.language_code,
      });
      await newUser.save();

      return newUser;
    }

    return user;
  }
);

export default model<IUser, UserModel>("User", UserSchema);
