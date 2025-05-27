import {MongoMemoryServer} from "mongodb-memory-server";

export = async function globalTeardown() {
   { // Config to decide if an mongodb-memory-server instance should be used
    const instance: MongoMemoryServer = (global as any).__MONGOINSTANCE;
    await instance.stop();
  }
};

