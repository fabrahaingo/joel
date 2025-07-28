import mongoose from "mongoose";
import { ErrorMessages } from "./entities/ErrorMessages.ts";

export const mongodbConnect = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
  }
  await mongoose.connect(process.env.MONGODB_URI);
};
