import { MongoMemoryServer } from "mongodb-memory-server";
const path = require("node:path");
const fs = require("fs");

const globalSetup = async () => {
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  // Store the URI in a temporary file that can be read by all test processes
  const globalConfigPath = path.join(__dirname, "globalConfigMongo.json");
  const mongoConfig = {
    mongoUri,
    mongoDBName: "jest",
  };

  fs.writeFileSync(globalConfigPath, JSON.stringify(mongoConfig));

  // Add this to make the server persist between tests
  (global as any).__MONGOSERVER__ = mongoServer;
};

export default globalSetup;
