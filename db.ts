import mongoose from "mongoose";
import { ErrorMessages } from "./entities/ErrorMessages";

export const mongodbConnect = async () => {
  const MONGODB_URI = process.env.MONGODB_URI;

  if (MONGODB_URI === undefined) {
    throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
  }

  if (!process.env.MONGODB_URI) {
    throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
  }
  await mongoose.connect(process.env.MONGODB_URI);
};
