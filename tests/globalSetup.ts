import { MongoMemoryServer } from "mongodb-memory-server";
import * as mongoose from "mongoose";

export default async function globalSetup() {
  // it's needed in global space, because we don't want to create a new instance every test-suite
  const instance = await MongoMemoryServer.create();
  const uri = instance.getUri();
  (global as any).__MONGOINSTANCE = instance;
  process.env.MONGO_URI_TEST = uri.slice(0, uri.lastIndexOf("/"));

  // The following is to make sure the database is clean before a test suite starts
  const conn = await mongoose.connect(`${process.env.MONGO_URI_TEST}/test`);
  if (!conn.connection.db) throw new Error("No db connection found.");
  await conn.connection.db.dropDatabase();
  await mongoose.disconnect();
}
