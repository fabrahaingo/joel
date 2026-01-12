import mongoose, { ConnectionStates } from "mongoose";
import { ErrorMessages } from "./entities/ErrorMessages.ts";

export const mongodbConnect = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
  }
  if (
    mongoose.connection.readyState === ConnectionStates.connected ||
    mongoose.connection.readyState === ConnectionStates.connecting
  )
    return;
  await mongoose.connect(process.env.MONGODB_URI);
};

export const mongodbDisconnect = async () => {
  // Mongoose state values: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (
    mongoose.connection.readyState === ConnectionStates.disconnected ||
    mongoose.connection.readyState === ConnectionStates.disconnecting
  )
    return;

  await mongoose.disconnect();
};
