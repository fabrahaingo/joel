import "dotenv/config";
import { mongodbConnect } from "../db.ts";
import User from "../models/User.ts";
import { migrateUser } from "../entities/Session.ts";
import { IRawUser } from "../models/LegacyUser.ts";

await (async function () {
  await mongodbConnect();

  const allUsers = (await User.collection.find().toArray()) as IRawUser[];
  for (const user of allUsers) {
    if (user.schemaVersion === 3) continue;
    const legacyUser = (await User.collection.findOne({
      messageApp: user.messageApp,
      chatId: user.chatId
    })) as IRawUser | null;
    if (legacyUser !== null) {
      await migrateUser(legacyUser);
    }
  }

  process.exit(0);
})();
