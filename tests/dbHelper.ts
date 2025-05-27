const path = require("node:path");
const fs = require("fs");
import { connect, connection } from "mongoose";

export const dbHelper = {
  setup: async () => {
    try {
      const globalConfigPath = path.join(__dirname, "globalConfigMongo.json");
      const configJSON = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));

      await connect(configJSON.mongoUri);
      console.log("Connected to MongoDB");
      console.log(configJSON.mongoUri);
      return connection;
    } catch (error) {
      console.error("Failed to connect to MongoDB:", error);
      throw error;
    }
  },

  reboot: async () => {
    try {
      await connection.close();
      const globalConfigPath = path.join(__dirname, "globalConfigMongo.json");
      const configJSON = JSON.parse(fs.readFileSync(globalConfigPath, "utf-8"));

      await connect(configJSON.mongoUri);
      return connection;
    } catch (error) {
      console.error("Failed to connect to MongoDB:", error);
      throw error;
    }
  },

  cleanup: async () => {
    try {
      await connection.dropDatabase();
      await connection.close();
    } catch (error) {
      console.error("Cleanup error:", error);
      throw error;
    }
  },
};
