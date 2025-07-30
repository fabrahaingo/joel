import { mongodbConnect } from "../db.ts";
import User from "../models/User.ts";
import { migrateUser } from "../entities/Session.ts";
import { IPeople } from "../types";
import People from "../models/People.ts";

await (async () => {
  // Connect to DB
  await mongodbConnect();

  const allPeople: IPeople[] = await People.find({});

  let modifiedPeopleNb = 0;
  for (const people of allPeople) {
    //await people.save();
    modifiedPeopleNb++;
  }

  const allUsersRaw = await User.collection.find({}).toArray();

  let modifiedUsersNb = 0;
  for (const userRaw of allUsersRaw) {
    //await migrateUser(userRaw);
    modifiedUsersNb++;
  }

  const incorrectPeople = await People.find({
    $or: [
      { prenom: { $exists: false } },
      { nom: { $exists: false } },
      { lastKnownPosition: { $exists: true } }
    ]
  });
  const incorrectPeopleNb = incorrectPeople.length;

  const incorrectUsers = await User.find({
    $or: [
      { chatId: { $exists: false } },
      { messageApp: { $exists: false } },
      { language_code: { $exists: false } },
      { status: { $exists: false } },
      { followedPeople: { $exists: false } },
      { followedFunctions: { $exists: false } },
      { followedNames: { $exists: false } },
      { followedOrganisations: { $exists: false } },
      { followedMeta: { $exists: false } }
    ]
  });
  const incorrectUsersNb = incorrectUsers.length;

  console.log(`Modified people: ${String(modifiedPeopleNb)}`);
  console.log(`Remaining incorrected users: ${String(incorrectPeopleNb)}`);

  console.log(`Modified users: ${String(modifiedUsersNb)}`);
  console.log(`Remaining incorrected users: ${String(incorrectUsersNb)}`);

  process.exit(0);
})();
