import mongoose from "mongoose";

export const mongodbConnect = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set. Please set it in your .env file");
  }
  await mongoose.connect(process.env.MONGODB_URI);
};
