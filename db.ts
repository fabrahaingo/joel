import mongoose from "mongoose";
import { ErrorMessages } from "./entities/ErrorMessages.ts";

export const mongodbConnect = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
  }
  if (
    mongoose.connection.readyState === mongoose.ConnectionStates.connected ||
    mongoose.connection.readyState === mongoose.ConnectionStates.connecting
  )
    return;

  await mongoose.connect(process.env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    family: 4
  });
};

export const mongodbDisconnect = async () => {
  // Mongoose state values: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  if (
    mongoose.connection.readyState === mongoose.ConnectionStates.disconnected ||
    mongoose.connection.readyState === mongoose.ConnectionStates.disconnecting
  )
    return;

  await mongoose.disconnect();
};
