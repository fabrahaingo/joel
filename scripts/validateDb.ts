import "dotenv/config";
import mongoose from "mongoose";
import { IOrganisation, IPeople, IUser } from "../types.ts";
import User from "../models/User.ts";
import People from "../models/People.ts";
import Organisation from "../models/Organisation.ts";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not defined");
}

await (async () => {
  await mongoose.connect(MONGODB_URI).then(async () => {
    const mdb = mongoose.connection.db;
    if (!mdb) {
      throw new Error("MongoDB connection failed");
    }

    const allPeople: IPeople[] = await People.find({});

    for (const people of allPeople) {
      await people.validate();
    }

    const allOrganisations: IOrganisation[] = await Organisation.find({});

    for (const org of allOrganisations) {
      await org.validate();
    }

    const allUsers: IUser[] = await User.find({});

    for (const user of allUsers) {
      await user.validate();
    }
  });

  process.exit(0);
})();
