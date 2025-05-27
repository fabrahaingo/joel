const path = require("node:path");
const fs = require("fs");

const globalTeardown = async () => {
  const mongoServer = (global as any).__MONGOSERVER__;
  if (mongoServer) {
    await mongoServer.stop();
  }

  // Clean up the config file
  const globalConfigPath = path.join(__dirname, "globalConfigMongo.json");
  if (fs.existsSync(globalConfigPath)) {
    fs.unlinkSync(globalConfigPath);
  }
};

export default globalTeardown;
