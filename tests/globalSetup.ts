import type { TestProject } from "vitest/node";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as mongoose from "mongoose";

export default async function setup(project: TestProject) {
  // Spin up a single in-memory MongoDB shared across every test suite.
  const instance = await MongoMemoryServer.create();
  const uri = instance.getUri();
  const base = uri.slice(0, uri.lastIndexOf("/"));
  project.provide("mongoUri", base);

  // Make sure the database is clean before any suite starts.
  const conn = await mongoose.connect(`${base}/test`);
  if (!conn.connection.db) throw new Error("No db connection found.");
  await conn.connection.db.dropDatabase();
  await mongoose.disconnect();

  return async () => {
    await instance.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}
