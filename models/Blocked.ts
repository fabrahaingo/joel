import mongoose, { model } from "mongoose";
import { IBlocked } from "../types.ts";
const Schema = mongoose.Schema;

const BlockedSchema = new Schema<IBlocked>(
  {
    chatId: {
      type: String,
      required: true,
      unique: true
    }
  },
  { timestamps: true }
);

export default model<IBlocked>("Blocked", BlockedSchema);
